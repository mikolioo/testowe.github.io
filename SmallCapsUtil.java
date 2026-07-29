package pl.wymiana.listener;

import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import pl.wymiana.Main;
import pl.wymiana.manager.ConfigManager;
import pl.wymiana.session.WymianaSession;
import pl.wymiana.util.ItemUtil;

import java.util.List;

/**
 * Zabezpiecza GUI wymiany przed wszystkimi znanymi exploitami:
 * duplikacja, shift-click, number-key, offhand-swap, drag, double-click,
 * wyrzucanie przedmiotów, kliknięcia poza GUI oraz transfery hopperów.
 */
public final class InventoryListener implements Listener {

    private final Main plugin;

    public InventoryListener(Main plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onInventoryClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;

        Inventory gui = plugin.getWymianaManager().getInventory(player.getUniqueId());
        if (gui == null) return;
        if (!gui.equals(event.getView().getTopInventory())) return;

        WymianaSession session = plugin.getWymianaManager().getSession(player.getUniqueId());
        if (session == null) {
            // Niespójny stan - blokujemy wszystko i zamykamy
            event.setCancelled(true);
            player.closeInventory();
            return;
        }

        ConfigManager cfg = plugin.getConfigManager();
        Inventory clicked = event.getClickedInventory();

        // Kliknięcie poza jakimkolwiek inwentarzem - blokuje wyrzucenie kursora
        if (clicked == null) {
            event.setCancelled(true);
            return;
        }

        boolean locked = session.getState() != WymianaSession.State.OPEN;

        // ================= EKWIPUNEK GRACZA =================
        if (!clicked.equals(gui)) {
            // Shift-click z ekwipunku: ręcznie przenosimy do WŁASNYCH wolnych slotów
            if (event.getAction() == InventoryAction.MOVE_TO_OTHER_INVENTORY) {
                event.setCancelled(true);
                if (locked) return;

                ItemStack moving = event.getCurrentItem();
                if (moving == null || moving.getType().isAir()) return;

                if (!ItemUtil.isAllowed(moving, cfg)) {
                    player.sendMessage(plugin.getMessageManager().get("trade.blocked-item"));
                    plugin.getSoundManager().playError(player);
                    return;
                }
                if (moveIntoOwnSlots(player, gui, event.getSlot())) {
                    plugin.getSoundManager().playItemPlace(player);
                    notifyChange(player);
                }
                return;
            }
            // Pozostałe operacje we własnym ekwipunku są bezpieczne
            return;
        }

        // ================= GUI WYMIANY =================
        int slot = event.getSlot();

        // Przycisk akceptacji (tylko własny)
        boolean ownAcceptButton =
                (session.isPlayerA(player.getUniqueId()) && slot == cfg.getSlotPlayerAAccept())
                        || (session.isPlayerB(player.getUniqueId()) && slot == cfg.getSlotPlayerBAccept());

        if (ownAcceptButton) {
            event.setCancelled(true);
            if (session.getState() == WymianaSession.State.OPEN) {
                runSync(() -> plugin.getWymianaManager().toggleAccept(player));
            }
            return;
        }

        // Sloty dekoracyjne, informacyjne, licznik i przycisk przeciwnika
        if (cfg.getReadOnlySlots().contains(slot)) {
            event.setCancelled(true);
            return;
        }

        // Strefa przeciwnika jest nietykalna
        if (!plugin.getWymianaManager().isOwnTradeSlot(player.getUniqueId(), slot)) {
            event.setCancelled(true);
            return;
        }

        // Podczas odliczania nic nie wolno zmieniać
        if (locked) {
            event.setCancelled(true);
            return;
        }

        ClickType click = event.getClick();
        InventoryAction action = event.getAction();

        // Number-key swap, offhand swap, double-click collect, wyrzucanie
        if (click == ClickType.NUMBER_KEY
                || click == ClickType.SWAP_OFFHAND
                || action == InventoryAction.COLLECT_TO_CURSOR
                || action == InventoryAction.DROP_ONE_SLOT
                || action == InventoryAction.DROP_ALL_SLOT
                || action == InventoryAction.DROP_ONE_CURSOR
                || action == InventoryAction.DROP_ALL_CURSOR) {
            event.setCancelled(true);
            return;
        }

        // Weryfikacja przedmiotu kładzionego z kursora
        ItemStack cursor = event.getCursor();
        if (cursor != null && !cursor.getType().isAir() && !ItemUtil.isAllowed(cursor, cfg)) {
            event.setCancelled(true);
            player.sendMessage(plugin.getMessageManager().get("trade.blocked-item"));
            plugin.getSoundManager().playError(player);
            return;
        }

        plugin.getSoundManager().playItemPlace(player);
        notifyChange(player);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onInventoryDrag(InventoryDragEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;

        Inventory gui = plugin.getWymianaManager().getInventory(player.getUniqueId());
        if (gui == null) return;
        if (!gui.equals(event.getView().getTopInventory())) return;

        int topSize = gui.getSize();
        boolean touchesTop = event.getRawSlots().stream().anyMatch(raw -> raw < topSize);
        if (!touchesTop) return;

        WymianaSession session = plugin.getWymianaManager().getSession(player.getUniqueId());
        if (session == null || session.getState() != WymianaSession.State.OPEN) {
            event.setCancelled(true);
            return;
        }

        // Każdy dotknięty slot GUI musi należeć do gracza
        for (int raw : event.getRawSlots()) {
            if (raw < topSize && !plugin.getWymianaManager().isOwnTradeSlot(player.getUniqueId(), raw)) {
                event.setCancelled(true);
                return;
            }
        }

        ConfigManager cfg = plugin.getConfigManager();
        ItemStack dragged = event.getOldCursor();
        if (dragged != null && !dragged.getType().isAir() && !ItemUtil.isAllowed(dragged, cfg)) {
            event.setCancelled(true);
            player.sendMessage(plugin.getMessageManager().get("trade.blocked-item"));
            plugin.getSoundManager().playError(player);
            return;
        }

        notifyChange(player);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onInventoryClose(InventoryCloseEvent event) {
        if (!(event.getPlayer() instanceof Player player)) return;

        Inventory gui = plugin.getWymianaManager().getInventory(player.getUniqueId());
        if (gui == null) return;
        if (!gui.equals(event.getInventory())) return;

        runSync(() -> plugin.getWymianaManager().onInventoryClose(player));
    }

    /**
     * Blokada transferów automatycznych (hoppery, droppery) do/z GUI wymiany.
     */
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onInventoryMoveItem(InventoryMoveItemEvent event) {
        if (isTradeInventory(event.getSource()) || isTradeInventory(event.getDestination())) {
            event.setCancelled(true);
        }
    }

    // ==========================================
    // Pomocnicze
    // ==========================================

    private boolean isTradeInventory(Inventory inventory) {
        if (inventory == null) return false;
        for (Inventory gui : plugin.getWymianaManager().getOpenInventories()) {
            if (gui.equals(inventory)) return true;
        }
        return false;
    }

    /**
     * Przenosi przedmiot z ekwipunku do pierwszych wolnych własnych slotów.
     * Zwraca true jeśli cokolwiek przeniesiono.
     */
    private boolean moveIntoOwnSlots(Player player, Inventory gui, int sourceSlot) {
        List<Integer> ownSlots = plugin.getWymianaManager().getOwnSlots(player.getUniqueId());
        ItemStack source = player.getInventory().getItem(sourceSlot);
        if (source == null || source.getType().isAir()) return false;

        ItemStack remaining = source.clone();
        boolean moved = false;

        // Najpierw dokładamy do istniejących stacków
        for (int slot : ownSlots) {
            if (remaining.getAmount() <= 0) break;
            ItemStack existing = gui.getItem(slot);
            if (existing == null || existing.getType().isAir()) continue;
            if (!existing.isSimilar(remaining)) continue;

            int space = existing.getMaxStackSize() - existing.getAmount();
            if (space <= 0) continue;

            int transfer = Math.min(space, remaining.getAmount());
            existing.setAmount(existing.getAmount() + transfer);
            gui.setItem(slot, existing);
            remaining.setAmount(remaining.getAmount() - transfer);
            moved = true;
        }

        // Następnie zajmujemy puste sloty
        for (int slot : ownSlots) {
            if (remaining.getAmount() <= 0) break;
            ItemStack existing = gui.getItem(slot);
            if (existing != null && !existing.getType().isAir()) continue;

            ItemStack placed = remaining.clone();
            gui.setItem(slot, placed);
            remaining.setAmount(0);
            moved = true;
        }

        if (!moved) return false;

        // Aktualizujemy ekwipunek gracza o to, co faktycznie zostało
        if (remaining.getAmount() <= 0) {
            player.getInventory().setItem(sourceSlot, null);
        } else {
            ItemStack left = source.clone();
            left.setAmount(remaining.getAmount());
            player.getInventory().setItem(sourceSlot, left);
        }
        player.updateInventory();
        return true;
    }

    private void notifyChange(Player player) {
        runSync(() -> plugin.getWymianaManager().onItemsChanged(player));
    }

    private void runSync(Runnable runnable) {
        if (!plugin.isEnabled()) return;
        plugin.getServer().getScheduler().runTask(plugin, runnable);
    }
}
