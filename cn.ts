package pl.wymiana.manager;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scheduler.BukkitRunnable;
import pl.wymiana.Main;
import pl.wymiana.session.WymianaSession;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Centralny manager wymiany - zarządza zaproszeniami, sesjami, timeoutami i odliczaniem.
 *
 * Wszystkie operacje na przedmiotach są wykonywane atomowo w głównym wątku serwera,
 * co eliminuje ryzyko duplikacji i desynchronizacji ekwipunku.
 */
public final class WymianaManager {

    private final Main plugin;

    /** Zaproszenia: target -> (sender -> timestamp). */
    private final Map<UUID, Map<UUID, Long>> pendingRequests = new ConcurrentHashMap<>();
    /** Cooldown wysyłania: sender -> timestamp. */
    private final Map<UUID, Long> cooldowns = new ConcurrentHashMap<>();
    /** Aktywne sesje: uuid gracza -> sesja (obaj gracze wskazują tę samą sesję). */
    private final Map<UUID, WymianaSession> activeSessions = new ConcurrentHashMap<>();
    /** Współdzielone GUI: uuid gracza -> inwentarz. */
    private final Map<UUID, Inventory> openInventories = new ConcurrentHashMap<>();
    /** Przedmioty do zwrotu graczom, którzy rozłączyli się w trakcie wymiany. */
    private final Map<UUID, List<ItemStack>> pendingReturns = new ConcurrentHashMap<>();

    public WymianaManager(Main plugin) {
        this.plugin = plugin;
    }

    // ========================================================
    // Zadania cykliczne
    // ========================================================

    public void startTasks() {
        new BukkitRunnable() {
            @Override
            public void run() {
                try {
                    tickRequests();
                } catch (Throwable t) {
                    plugin.getLogger().warning("Błąd w zadaniu zaproszeń: " + t.getMessage());
                }
            }
        }.runTaskTimer(plugin, 20L, 20L);

        new BukkitRunnable() {
            @Override
            public void run() {
                try {
                    tickCountdowns();
                } catch (Throwable t) {
                    plugin.getLogger().warning("Błąd w zadaniu odliczania: " + t.getMessage());
                }
            }
        }.runTaskTimer(plugin, 20L, 20L);
    }

    private void tickRequests() {
        long now = System.currentTimeMillis();
        long timeoutMs = plugin.getConfigManager().getRequestTimeout() * 1000L;

        Iterator<Map.Entry<UUID, Map<UUID, Long>>> outer = pendingRequests.entrySet().iterator();
        while (outer.hasNext()) {
            Map.Entry<UUID, Map<UUID, Long>> entry = outer.next();
            UUID target = entry.getKey();
            Map<UUID, Long> requests = entry.getValue();

            Iterator<Map.Entry<UUID, Long>> it = requests.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<UUID, Long> req = it.next();
                if (now - req.getValue() <= timeoutMs) continue;

                UUID sender = req.getKey();
                it.remove();

                Player senderPlayer = Bukkit.getPlayer(sender);
                Player targetPlayer = Bukkit.getPlayer(target);
                if (senderPlayer != null) {
                    plugin.getMessageManager().send(senderPlayer, "request.expired-sender", senderPlayer, nameOf(target));
                    plugin.getSoundManager().playRequestExpire(senderPlayer);
                }
                if (targetPlayer != null) {
                    plugin.getMessageManager().send(targetPlayer, "request.expired-target", targetPlayer, nameOf(sender));
                }
            }
            if (requests.isEmpty()) outer.remove();
        }
    }

    private void tickCountdowns() {
        for (WymianaSession session : new ArrayList<>(activeSessions.values())) {
            if (session.getState() != WymianaSession.State.COUNTDOWN) continue;

            Player a = session.getPlayerAOnline();
            Player b = session.getPlayerBOnline();
            if (a == null || b == null) {
                cancelSession(session, "trade.cancelled-disconnect");
                continue;
            }

            // Ochrona: ktokolwiek zmienił przedmioty w trakcie odliczania
            if (itemsChangedDuringCountdown(session)) {
                resetToOpen(session);
                continue;
            }

            // Ochrona: odległość / świat
            if (!validateProximity(a, b, false)) {
                cancelSession(session, "trade.too-far");
                continue;
            }

            session.decrementCountdown();
            int left = session.getCountdownSeconds();

            Inventory inv = openInventories.get(session.getPlayerA());
            if (inv != null) plugin.getGUIManager().updateCountdown(inv, left);

            plugin.getSoundManager().playCountdownTick(a);
            plugin.getSoundManager().playCountdownTick(b);

            if (plugin.getConfigManager().isCountdownAnimation()) {
                showCountdownTitle(a, left);
                showCountdownTitle(b, left);
            }

            if (left <= 0) {
                plugin.getSoundManager().playCountdownEnd(a);
                plugin.getSoundManager().playCountdownEnd(b);
                completeTrade(session);
            }
        }
    }

    // ========================================================
    // Zaproszenia
    // ========================================================

    public void sendRequest(Player sender, Player target) {
        MessageManager msg = plugin.getMessageManager();
        SoundManager snd = plugin.getSoundManager();
        ConfigManager cfg = plugin.getConfigManager();

        if (sender.getUniqueId().equals(target.getUniqueId())) {
            msg.send(sender, "request.self");
            snd.playError(sender);
            return;
        }
        if (!target.isOnline()) {
            msg.send(sender, "request.target-offline", sender, target.getName());
            snd.playError(sender);
            return;
        }
        if (isInSession(sender.getUniqueId())) {
            msg.send(sender, "request.sender-busy");
            snd.playError(sender);
            return;
        }
        if (isInSession(target.getUniqueId())) {
            msg.send(sender, "request.target-busy", sender, target.getName());
            snd.playError(sender);
            return;
        }
        if (!validateProximity(sender, target, true)) {
            snd.playError(sender);
            return;
        }

        long now = System.currentTimeMillis();
        Long last = cooldowns.get(sender.getUniqueId());
        if (last != null && !sender.hasPermission(cfg.getPermissionBypassCooldown())) {
            long elapsed = (now - last) / 1000L;
            if (elapsed < cfg.getRequestCooldown()) {
                long remain = cfg.getRequestCooldown() - elapsed;
                sender.sendMessage(msg.get("request.cooldown", sender, target.getName(),
                        "%seconds%", String.valueOf(remain)));
                snd.playError(sender);
                return;
            }
        }

        Map<UUID, Long> targetRequests =
                pendingRequests.computeIfAbsent(target.getUniqueId(), k -> new ConcurrentHashMap<>());

        if (targetRequests.containsKey(sender.getUniqueId())) {
            msg.send(sender, "request.already-sent", sender, target.getName());
            snd.playError(sender);
            return;
        }
        if (targetRequests.size() >= cfg.getMaxPendingPerTarget()) {
            msg.send(sender, "request.target-full", sender, target.getName());
            snd.playError(sender);
            return;
        }

        int sentCount = 0;
        for (Map<UUID, Long> map : pendingRequests.values()) {
            if (map.containsKey(sender.getUniqueId())) sentCount++;
        }
        if (sentCount >= cfg.getMaxPendingPerSender()) {
            msg.send(sender, "request.sender-full");
            snd.playError(sender);
            return;
        }

        targetRequests.put(sender.getUniqueId(), now);
        cooldowns.put(sender.getUniqueId(), now);

        msg.send(sender, "request.sent", sender, target.getName());
        msg.sendList(target, "request.received", sender, sender.getName(), cfg.getRequestTimeout());

        snd.playRequestSend(sender);
        snd.playRequestReceive(target);
    }

    public void acceptRequest(Player target, Player sender) {
        MessageManager msg = plugin.getMessageManager();
        SoundManager snd = plugin.getSoundManager();

        if (!hasPendingRequest(target.getUniqueId(), sender.getUniqueId())) {
            msg.send(target, "request.not-found", target, sender.getName());
            snd.playError(target);
            return;
        }
        if (isInSession(target.getUniqueId())) {
            msg.send(target, "request.sender-busy");
            snd.playError(target);
            return;
        }
        if (isInSession(sender.getUniqueId())) {
            msg.send(target, "request.target-busy", target, sender.getName());
            snd.playError(target);
            return;
        }
        if (!sender.isOnline()) {
            msg.send(target, "request.target-offline", target, sender.getName());
            snd.playError(target);
            removeRequest(target.getUniqueId(), sender.getUniqueId());
            return;
        }
        if (!validateProximity(target, sender, true)) {
            snd.playError(target);
            return;
        }

        removeRequest(target.getUniqueId(), sender.getUniqueId());
        // Anty-spam: usuwamy wzajemne zaproszenia obu graczy
        removeRequest(sender.getUniqueId(), target.getUniqueId());

        WymianaSession session = new WymianaSession(sender.getUniqueId(), target.getUniqueId());
        activeSessions.put(sender.getUniqueId(), session);
        activeSessions.put(target.getUniqueId(), session);

        Inventory gui = plugin.getGUIManager().createTradeGUI(sender, target);
        openInventories.put(sender.getUniqueId(), gui);
        openInventories.put(target.getUniqueId(), gui);

        sender.openInventory(gui);
        target.openInventory(gui);

        msg.send(sender, "accept.accepted-sender", sender, target.getName());
        msg.send(target, "accept.accepted-target", target, sender.getName());
        snd.playAcceptClick(sender);
        snd.playAcceptClick(target);
    }

    public void rejectRequest(Player target, Player sender) {
        MessageManager msg = plugin.getMessageManager();

        if (!hasPendingRequest(target.getUniqueId(), sender.getUniqueId())) {
            msg.send(target, "request.not-found", target, sender.getName());
            plugin.getSoundManager().playError(target);
            return;
        }
        removeRequest(target.getUniqueId(), sender.getUniqueId());
        msg.send(target, "accept.rejected-target", target, sender.getName());
        msg.send(sender, "accept.rejected-sender", sender, target.getName());
        plugin.getSoundManager().playTradeCancel(sender);
    }

    // ========================================================
    // Akceptacja w GUI
    // ========================================================

    public void toggleAccept(Player player) {
        WymianaSession session = getSession(player.getUniqueId());
        if (session == null || session.getState() != WymianaSession.State.OPEN) return;

        boolean wasAccepted = session.isAccepted(player.getUniqueId());
        session.setAccepted(player.getUniqueId(), !wasAccepted);

        Inventory inv = openInventories.get(player.getUniqueId());
        refreshGui(session, inv);

        if (!wasAccepted) plugin.getSoundManager().playConfirmAccept(player);
        else plugin.getSoundManager().playAcceptClick(player);

        if (session.bothAccepted()) {
            startCountdown(session, inv);
        }
    }

    private void startCountdown(WymianaSession session, Inventory inv) {
        session.setState(WymianaSession.State.COUNTDOWN);
        session.setCountdownSeconds(plugin.getConfigManager().getCountdownSeconds());
        session.setCountdownEndTime(System.currentTimeMillis()
                + plugin.getConfigManager().getCountdownSeconds() * 1000L);

        if (inv != null) {
            ConfigManager cfg = plugin.getConfigManager();
            // Zapamiętujemy stan przedmiotów - każda zmiana anuluje odliczanie
            session.setPlayerALastHash(WymianaSession.computeItemsHash(getItems(inv, cfg.getSlotsPlayerA())));
            session.setPlayerBLastHash(WymianaSession.computeItemsHash(getItems(inv, cfg.getSlotsPlayerB())));
            plugin.getGUIManager().updateCountdown(inv, session.getCountdownSeconds());
        }
    }

    /**
     * Powrót z odliczania do stanu edycji (np. gdy przedmioty się zmieniły).
     */
    private void resetToOpen(WymianaSession session) {
        session.setState(WymianaSession.State.OPEN);
        session.resetAccepts();
        session.setCountdownSeconds(0);
        session.setCountdownEndTime(0L);

        Inventory inv = openInventories.get(session.getPlayerA());
        if (inv != null) {
            plugin.getGUIManager().updateCountdown(inv, -1);
            refreshGui(session, inv);
        }

        Player a = session.getPlayerAOnline();
        Player b = session.getPlayerBOnline();
        String message = plugin.getMessageManager().get("trade.reset-due-to-change");
        if (a != null) {
            a.sendMessage(message);
            plugin.getSoundManager().playResetAccept(a);
            a.clearTitle();
        }
        if (b != null) {
            b.sendMessage(message);
            plugin.getSoundManager().playResetAccept(b);
            b.clearTitle();
        }
    }

    /**
     * Wywoływane po każdej zmianie przedmiotów w slotach handlowych.
     */
    public void onItemsChanged(Player changer) {
        WymianaSession session = getSession(changer.getUniqueId());
        if (session == null) return;

        if (session.getState() == WymianaSession.State.COUNTDOWN) {
            resetToOpen(session);
            return;
        }
        if (session.getState() != WymianaSession.State.OPEN) return;

        Inventory inv = openInventories.get(changer.getUniqueId());

        if (session.isPlayerAAccepted() || session.isPlayerBAccepted()) {
            session.resetAccepts();
            Player a = session.getPlayerAOnline();
            Player b = session.getPlayerBOnline();
            String message = plugin.getMessageManager().get("trade.reset-due-to-change");
            if (a != null) {
                a.sendMessage(message);
                plugin.getSoundManager().playResetAccept(a);
            }
            if (b != null) {
                b.sendMessage(message);
                plugin.getSoundManager().playResetAccept(b);
            }
        }
        refreshGui(session, inv);
    }

    private void refreshGui(WymianaSession session, Inventory inv) {
        if (inv == null) return;
        ConfigManager cfg = plugin.getConfigManager();
        int aCount = countTradeItems(inv, cfg.getSlotsPlayerA());
        int bCount = countTradeItems(inv, cfg.getSlotsPlayerB());

        plugin.getGUIManager().updateAcceptButtons(inv,
                session.isPlayerAAccepted(), session.isPlayerBAccepted(), aCount, bCount);

        Player a = session.getPlayerAOnline();
        Player b = session.getPlayerBOnline();
        if (a != null && b != null) {
            plugin.getGUIManager().updatePlayerInfo(inv, a, b, aCount, bCount);
        }
    }

    private boolean itemsChangedDuringCountdown(WymianaSession session) {
        Inventory inv = openInventories.get(session.getPlayerA());
        if (inv == null) return true;
        ConfigManager cfg = plugin.getConfigManager();
        int hashA = WymianaSession.computeItemsHash(getItems(inv, cfg.getSlotsPlayerA()));
        int hashB = WymianaSession.computeItemsHash(getItems(inv, cfg.getSlotsPlayerB()));
        return hashA != session.getPlayerALastHash() || hashB != session.getPlayerBLastHash();
    }

    // ========================================================
    // Finalizacja
    // ========================================================

    public void completeTrade(WymianaSession session) {
        if (session.getState() != WymianaSession.State.COUNTDOWN) return;

        Player a = session.getPlayerAOnline();
        Player b = session.getPlayerBOnline();
        if (a == null || b == null) {
            cancelSession(session, "trade.cancelled-disconnect");
            return;
        }

        Inventory inv = openInventories.get(session.getPlayerA());
        if (inv == null) {
            cancelSession(session, "trade.cancelled-self");
            return;
        }

        ConfigManager cfg = plugin.getConfigManager();
        List<ItemStack> itemsA = getItems(inv, cfg.getSlotsPlayerA());
        List<ItemStack> itemsB = getItems(inv, cfg.getSlotsPlayerB());

        // Ostateczna weryfikacja miejsca w ekwipunku obu stron
        if (!hasSpace(a, itemsB) || !hasSpace(b, itemsA)) {
            String noSpace = plugin.getMessageManager().get("trade.no-inventory-space");
            a.sendMessage(noSpace);
            b.sendMessage(noSpace);
            cancelSession(session, null);
            return;
        }

        // Punkt bez powrotu - blokujemy dalsze modyfikacje
        session.setState(WymianaSession.State.COMPLETED);

        // 1) Usuwamy przedmioty z GUI (jedyne źródło prawdy)
        for (int slot : cfg.getSlotsPlayerA()) inv.setItem(slot, null);
        for (int slot : cfg.getSlotsPlayerB()) inv.setItem(slot, null);

        // 2) Przekazujemy krzyżowo
        giveItems(a, itemsB);
        giveItems(b, itemsA);

        // 3) Sprzątamy PRZED zamknięciem GUI, aby handler close nie anulował wymiany
        cleanupSession(session);
        closeInventories(a, b);

        plugin.getMessageManager().send(a, "trade.success", a, b.getName());
        plugin.getMessageManager().send(b, "trade.success", b, a.getName());
        plugin.getSoundManager().playTradeSuccess(a);
        plugin.getSoundManager().playTradeSuccess(b);

        showConfiguredTitle(a, "animations.trade-complete");
        showConfiguredTitle(b, "animations.trade-complete");

        if (cfg.isLogTrades()) {
            plugin.getLogger().info(String.format(
                    "Wymiana zakonczona: %s <-> %s (%d <-> %d przedmiotow)",
                    a.getName(), b.getName(), countNonEmpty(itemsA), countNonEmpty(itemsB)));
        }
    }

    public void cancelSession(WymianaSession session, String messagePath) {
        if (session.getState() == WymianaSession.State.COMPLETED
                || session.getState() == WymianaSession.State.CANCELLED) {
            cleanupSession(session);
            return;
        }
        session.setState(WymianaSession.State.CANCELLED);

        Player a = session.getPlayerAOnline();
        Player b = session.getPlayerBOnline();
        Inventory inv = openInventories.get(session.getPlayerA());

        // Zwrot przedmiotów prawowitym właścicielom
        if (inv != null) {
            ConfigManager cfg = plugin.getConfigManager();
            List<ItemStack> itemsA = getItems(inv, cfg.getSlotsPlayerA());
            List<ItemStack> itemsB = getItems(inv, cfg.getSlotsPlayerB());

            for (int slot : cfg.getSlotsPlayerA()) inv.setItem(slot, null);
            for (int slot : cfg.getSlotsPlayerB()) inv.setItem(slot, null);

            returnItems(session.getPlayerA(), a, itemsA);
            returnItems(session.getPlayerB(), b, itemsB);
        }

        cleanupSession(session);
        closeInventories(a, b);

        if (messagePath != null) {
            String message = plugin.getMessageManager().get(messagePath);
            if (a != null) a.sendMessage(message);
            if (b != null) b.sendMessage(message);
        }
        if (a != null) {
            plugin.getSoundManager().playTradeCancel(a);
            showConfiguredTitle(a, "animations.trade-cancelled");
        }
        if (b != null) {
            plugin.getSoundManager().playTradeCancel(b);
            showConfiguredTitle(b, "animations.trade-cancelled");
        }
    }

    private void cleanupSession(WymianaSession session) {
        activeSessions.remove(session.getPlayerA());
        activeSessions.remove(session.getPlayerB());
        openInventories.remove(session.getPlayerA());
        openInventories.remove(session.getPlayerB());
    }

    // ========================================================
    // Zdarzenia gracza
    // ========================================================

    public void onPlayerQuit(Player player) {
        UUID uuid = player.getUniqueId();

        pendingRequests.remove(uuid);
        for (Map<UUID, Long> map : pendingRequests.values()) {
            map.remove(uuid);
        }
        cooldowns.remove(uuid);

        WymianaSession session = activeSessions.get(uuid);
        if (session != null) {
            cancelSession(session, "trade.cancelled-disconnect");
        }
    }

    public void onPlayerDeath(Player player) {
        WymianaSession session = activeSessions.get(player.getUniqueId());
        if (session != null) {
            cancelSession(session, "trade.cancelled-death");
        }
    }

    public void onInventoryClose(Player player) {
        WymianaSession session = activeSessions.get(player.getUniqueId());
        if (session == null) return;
        if (session.getState() == WymianaSession.State.COMPLETED
                || session.getState() == WymianaSession.State.CANCELLED) return;
        cancelSession(session, "trade.cancelled-self");
    }

    // ========================================================
    // Zapytania
    // ========================================================

    public boolean hasPendingRequest(UUID target, UUID sender) {
        Map<UUID, Long> map = pendingRequests.get(target);
        return map != null && map.containsKey(sender);
    }

    public void removeRequest(UUID target, UUID sender) {
        Map<UUID, Long> map = pendingRequests.get(target);
        if (map == null) return;
        map.remove(sender);
        if (map.isEmpty()) pendingRequests.remove(target);
    }

    public boolean isInSession(UUID uuid) {
        return activeSessions.containsKey(uuid);
    }

    public WymianaSession getSession(UUID uuid) {
        return activeSessions.get(uuid);
    }

    public Inventory getInventory(UUID uuid) {
        return openInventories.get(uuid);
    }

    /** Wszystkie aktualnie otwarte GUI wymiany (do blokady hopperów). */
    public Collection<Inventory> getOpenInventories() {
        return openInventories.values();
    }

    /** Czy slot należy do własnej strefy handlowej gracza. */
    public boolean isOwnTradeSlot(UUID player, int slot) {
        WymianaSession session = getSession(player);
        if (session == null) return false;
        ConfigManager cfg = plugin.getConfigManager();
        if (session.isPlayerA(player)) return cfg.getPlayerAEditable().contains(slot);
        if (session.isPlayerB(player)) return cfg.getPlayerBEditable().contains(slot);
        return false;
    }

    /** Lista slotów należących do danego gracza. */
    public List<Integer> getOwnSlots(UUID player) {
        WymianaSession session = getSession(player);
        ConfigManager cfg = plugin.getConfigManager();
        if (session == null) return new ArrayList<>();
        return session.isPlayerA(player) ? cfg.getSlotsPlayerA() : cfg.getSlotsPlayerB();
    }

    // ========================================================
    // Narzędzia
    // ========================================================

    private boolean validateProximity(Player one, Player two, boolean notify) {
        ConfigManager cfg = plugin.getConfigManager();

        if (cfg.isBlockCrossWorld() && !one.getWorld().equals(two.getWorld())) {
            if (notify) {
                one.sendMessage(plugin.getMessageManager().get("trade.different-world", one, two.getName()));
            }
            return false;
        }
        if (cfg.getMaxDistance() > 0) {
            if (!one.getWorld().equals(two.getWorld())
                    || one.getLocation().distance(two.getLocation()) > cfg.getMaxDistance()) {
                if (notify) {
                    one.sendMessage(plugin.getMessageManager().get("trade.too-far", one, two.getName()));
                }
                return false;
            }
        }
        return true;
    }

    private void showCountdownTitle(Player player, int seconds) {
        String title = plugin.getConfig().getString("animations.countdown.title", "");
        String subtitle = plugin.getConfig().getString("animations.countdown.subtitle", "");
        int fadeIn = plugin.getConfig().getInt("animations.countdown.fade-in", 0);
        int stay = plugin.getConfig().getInt("animations.countdown.stay", 20);
        int fadeOut = plugin.getConfig().getInt("animations.countdown.fade-out", 0);

        Component t = plugin.getMessageManager().toComponent(title.replace("{seconds}", String.valueOf(seconds)));
        Component s = plugin.getMessageManager().toComponent(subtitle.replace("{seconds}", String.valueOf(seconds)));

        player.showTitle(Title.title(t, s, Title.Times.times(
                ticks(fadeIn), ticks(stay), ticks(fadeOut))));
    }

    private void showConfiguredTitle(Player player, String path) {
        if (!plugin.getConfig().getBoolean(path + ".enabled", true)) return;

        Component t = plugin.getMessageManager().toComponent(plugin.getConfig().getString(path + ".title", ""));
        Component s = plugin.getMessageManager().toComponent(plugin.getConfig().getString(path + ".subtitle", ""));
        int fadeIn = plugin.getConfig().getInt(path + ".fade-in", 10);
        int stay = plugin.getConfig().getInt(path + ".stay", 40);
        int fadeOut = plugin.getConfig().getInt(path + ".fade-out", 20);

        player.showTitle(Title.title(t, s, Title.Times.times(
                ticks(fadeIn), ticks(stay), ticks(fadeOut))));
    }

    private Duration ticks(int ticks) {
        return Duration.ofMillis(Math.max(0, ticks) * 50L);
    }

    /**
     * Zamyka GUI obu graczy. Podczas wyłączania pluginu robi to natychmiast,
     * ponieważ scheduler nie przyjmuje wtedy nowych zadań.
     */
    private void closeInventories(Player a, Player b) {
        if (!plugin.isEnabled()) {
            if (a != null) a.closeInventory();
            if (b != null) b.closeInventory();
            return;
        }
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (a != null && a.isOnline()) a.closeInventory();
            if (b != null && b.isOnline()) b.closeInventory();
        });
    }

    private String nameOf(UUID uuid) {
        Player online = Bukkit.getPlayer(uuid);
        if (online != null) return online.getName();
        String offline = Bukkit.getOfflinePlayer(uuid).getName();
        return offline != null ? offline : uuid.toString().substring(0, 8);
    }

    private List<ItemStack> getItems(Inventory inv, List<Integer> slots) {
        List<ItemStack> list = new ArrayList<>(slots.size());
        for (int slot : slots) {
            ItemStack item = inv.getItem(slot);
            if (item != null && !item.getType().isAir()) {
                list.add(item.clone());
            }
        }
        return list;
    }

    private int countTradeItems(Inventory inv, List<Integer> slots) {
        int count = 0;
        for (int slot : slots) {
            ItemStack item = inv.getItem(slot);
            if (item != null && !item.getType().isAir()) count++;
        }
        return count;
    }

    private int countNonEmpty(List<ItemStack> items) {
        int count = 0;
        for (ItemStack item : items) {
            if (item != null && !item.getType().isAir()) count++;
        }
        return count;
    }

    /**
     * Symuluje dodanie przedmiotów do kopii ekwipunku, aby sprawdzić czy się zmieszczą.
     */
    private boolean hasSpace(Player player, List<ItemStack> items) {
        if (items.isEmpty()) return true;

        Inventory simulation = Bukkit.createInventory(null, 36);
        ItemStack[] storage = player.getInventory().getStorageContents();
        for (int i = 0; i < storage.length && i < 36; i++) {
            if (storage[i] != null) simulation.setItem(i, storage[i].clone());
        }
        for (ItemStack item : items) {
            if (item == null || item.getType().isAir()) continue;
            Map<Integer, ItemStack> leftover = simulation.addItem(item.clone());
            if (!leftover.isEmpty()) return false;
        }
        return true;
    }

    private void giveItems(Player player, List<ItemStack> items) {
        for (ItemStack item : items) {
            if (item == null || item.getType().isAir()) continue;
            Map<Integer, ItemStack> leftover = player.getInventory().addItem(item);
            for (ItemStack rest : leftover.values()) {
                player.getWorld().dropItemNaturally(player.getLocation(), rest);
            }
        }
    }

    /**
     * Zwraca przedmioty właścicielowi.
     * Gdy gracz jest offline, przedmioty trafiają do kolejki zwrotów
     * i zostaną wydane automatycznie przy następnym wejściu na serwer.
     * Dzięki temu nic nie ginie i nie da się nadużyć rozłączenia.
     */
    private void returnItems(UUID owner, Player online, List<ItemStack> items) {
        if (items.isEmpty()) return;

        if (online != null && online.isOnline()) {
            giveItems(online, items);
            return;
        }
        pendingReturns.computeIfAbsent(owner, k -> new ArrayList<>()).addAll(items);
        plugin.getLogger().info("Zakolejkowano zwrot " + items.size()
                + " przedmiotow dla gracza " + owner + " (offline).");
    }

    /**
     * Wydaje zaległe przedmioty po ponownym wejściu gracza na serwer.
     */
    public void deliverPendingReturns(Player player) {
        List<ItemStack> items = pendingReturns.remove(player.getUniqueId());
        if (items == null || items.isEmpty()) return;
        giveItems(player, items);
        plugin.getLogger().info("Zwrocono " + items.size() + " przedmiotow graczowi " + player.getName() + ".");
    }

    /**
     * Bezpiecznie kończy wszystkie sesje przy wyłączaniu pluginu.
     */
    public void shutdownAll() {
        for (WymianaSession session : new ArrayList<>(activeSessions.values())) {
            try {
                cancelSession(session, null);
            } catch (Throwable t) {
                plugin.getLogger().warning("Nie udało się zamknąć sesji: " + t.getMessage());
            }
        }
        activeSessions.clear();
        openInventories.clear();
        pendingRequests.clear();
        cooldowns.clear();
    }
}
