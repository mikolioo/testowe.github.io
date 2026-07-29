package pl.wymiana.manager;

import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.SkullMeta;
import pl.wymiana.Main;
import pl.wymiana.session.WymianaSession;
import pl.wymiana.util.ItemUtil;

import java.util.ArrayList;
import java.util.List;

/**
 * Buduje i aktualizuje GUI wymiany (54 sloty, układ inspirowany Hypixel).
 *
 * Układ domyślny:
 *   - lewa strona  (10,11,12,19,20,21,28,29,30) - gracz A
 *   - prawa strona (14,15,16,23,24,25,32,33,34) - gracz B
 *   - środek       (13,22,31,40,49)             - szyby dekoracyjne
 *   - przyciski akceptacji: 38 (A) i 41 (B)
 *   - odliczanie: slot 4
 */
public final class GUIManager {

    private final Main plugin;

    public GUIManager(Main plugin) {
        this.plugin = plugin;
    }

    /**
     * Tworzy współdzielone GUI wymiany dla dwóch graczy.
     */
    public Inventory createTradeGUI(Player playerA, Player playerB) {
        ConfigManager cfg = plugin.getConfigManager();
        Inventory inv = Bukkit.createInventory(null, cfg.getGuiSize(), plugin.getMessageManager().getGuiTitle());

        ItemStack fill = buildFillPane();
        for (int slot : cfg.getSlotsFill()) {
            if (isValidSlot(slot, cfg)) inv.setItem(slot, fill);
        }

        ItemStack decorative = buildDecorativePane();
        for (int slot : cfg.getSlotsCenterDecorative()) {
            if (isValidSlot(slot, cfg)) inv.setItem(slot, decorative);
        }

        inv.setItem(cfg.getSlotPlayerAInfo(), buildPlayerInfo(playerA, playerB, 0));
        inv.setItem(cfg.getSlotPlayerBInfo(), buildPlayerInfo(playerB, playerA, 0));

        inv.setItem(cfg.getSlotPlayerAAccept(), buildAcceptButton(false, false, 0));
        inv.setItem(cfg.getSlotPlayerBAccept(), buildAcceptButton(false, false, 0));

        inv.setItem(cfg.getSlotCountdownDisplay(), buildCountdownDisplay(-1));

        return inv;
    }

    private boolean isValidSlot(int slot, ConfigManager cfg) {
        return slot >= 0 && slot < cfg.getGuiSize();
    }

    /**
     * Odświeża oba przyciski akceptacji.
     */
    public void updateAcceptButtons(Inventory inv, boolean aAccepted, boolean bAccepted, int aCount, int bCount) {
        ConfigManager cfg = plugin.getConfigManager();
        inv.setItem(cfg.getSlotPlayerAAccept(), buildAcceptButton(aAccepted, bAccepted, aCount));
        inv.setItem(cfg.getSlotPlayerBAccept(), buildAcceptButton(bAccepted, aAccepted, bCount));
    }

    /**
     * Aktualizuje licznik odliczania. Wartość ujemna oznacza stan bezczynny.
     */
    public void updateCountdown(Inventory inv, int seconds) {
        ConfigManager cfg = plugin.getConfigManager();
        inv.setItem(cfg.getSlotCountdownDisplay(), buildCountdownDisplay(seconds));
    }

    /**
     * Aktualizuje głowy graczy wraz z licznikiem przedmiotów i statusem.
     */
    public void updatePlayerInfo(Inventory inv, Player playerA, Player playerB, int aItems, int bItems) {
        ConfigManager cfg = plugin.getConfigManager();
        inv.setItem(cfg.getSlotPlayerAInfo(), buildPlayerInfo(playerA, playerB, aItems));
        inv.setItem(cfg.getSlotPlayerBInfo(), buildPlayerInfo(playerB, playerA, bItems));
    }

    // ==========================================
    // Elementy GUI
    // ==========================================

    private ItemStack buildFillPane() {
        ConfigManager cfg = plugin.getConfigManager();
        MessageManager msg = plugin.getMessageManager();
        return ItemUtil.build(cfg.getFillPaneMat(),
                msg.get("gui.fill-pane-name"),
                msg.getList("gui.fill-pane-lore"),
                cfg.getCmdFill());
    }

    private ItemStack buildDecorativePane() {
        ConfigManager cfg = plugin.getConfigManager();
        MessageManager msg = plugin.getMessageManager();
        return ItemUtil.build(cfg.getDecorativePaneMat(),
                msg.get("gui.decorative-pane-name"),
                msg.getList("gui.decorative-pane-lore"),
                cfg.getCmdDecorative());
    }

    private ItemStack buildPlayerInfo(Player owner, Player other, int itemCount) {
        MessageManager msg = plugin.getMessageManager();

        ItemStack head = new ItemStack(Material.PLAYER_HEAD);
        SkullMeta meta = (SkullMeta) head.getItemMeta();
        if (meta == null) return head;

        meta.setOwningPlayer(owner);
        meta.displayName(ItemUtil.toComponent(msg.get("gui.player-info-name", owner, other.getName())));

        String status = resolveStatus(owner);

        List<Component> lore = new ArrayList<>();
        for (String line : msg.getList("gui.player-info-lore", owner, other.getName())) {
            lore.add(ItemUtil.toComponent(line
                    .replace("%items%", String.valueOf(itemCount))
                    .replace("%status%", status)
                    .replace("%other%", other.getName())));
        }
        meta.lore(lore);
        head.setItemMeta(meta);
        return head;
    }

    private String resolveStatus(Player player) {
        WymianaSession session = plugin.getWymianaManager().getSession(player.getUniqueId());
        if (session == null) return "ᴏᴄᴢᴇᴋᴜᴊᴇ";
        if (session.getState() == WymianaSession.State.COUNTDOWN) return "ᴏᴅʟɪᴄᴢᴀɴɪᴇ";
        if (session.isAccepted(player.getUniqueId())) return "ᴢᴀᴀᴋᴄᴇᴘᴛᴏᴡᴀł";
        return "ᴏᴄᴢᴇᴋᴜᴊᴇ";
    }

    /**
     * Trzy stany przycisku:
     *   - nikt nie zaakceptował  -> gotowy
     *   - ja zaakceptowałem      -> oczekiwanie na drugiego
     *   - obaj zaakceptowali     -> potwierdzony
     */
    private ItemStack buildAcceptButton(boolean selfAccepted, boolean otherAccepted, int itemCount) {
        ConfigManager cfg = plugin.getConfigManager();
        MessageManager msg = plugin.getMessageManager();

        Material material;
        String nameKey;
        String loreKey;
        int customModelData;

        if (selfAccepted && otherAccepted) {
            material = cfg.getAcceptConfirmedMat();
            nameKey = "gui.accept-button-confirmed";
            loreKey = "gui.accept-button-lore-confirmed";
            customModelData = cfg.getCmdAcceptConfirmed();
        } else if (selfAccepted) {
            material = cfg.getAcceptWaitingMat();
            nameKey = "gui.accept-button-waiting";
            loreKey = "gui.accept-button-lore-waiting";
            customModelData = cfg.getCmdAcceptWaiting();
        } else {
            material = cfg.getAcceptReadyMat();
            nameKey = "gui.accept-button-ready";
            loreKey = "gui.accept-button-lore-ready";
            customModelData = cfg.getCmdAcceptReady();
        }

        List<String> lore = msg.getList(loreKey);
        lore.replaceAll(line -> line.replace("%items%", String.valueOf(itemCount)));

        return ItemUtil.build(material, msg.get(nameKey), lore, customModelData);
    }

    private ItemStack buildCountdownDisplay(int seconds) {
        ConfigManager cfg = plugin.getConfigManager();
        MessageManager msg = plugin.getMessageManager();

        String value = seconds < 0 ? "-" : String.valueOf(seconds);

        String name = msg.get("gui.countdown-display-name").replace("%seconds%", value);
        List<String> lore = msg.getList("gui.countdown-display-lore");
        lore.replaceAll(line -> line.replace("%seconds%", value));

        ItemStack item = ItemUtil.build(cfg.getCountdownFrameMat(), name, lore, 0);
        // Wizualne odliczanie w stacku (1..64) gdy trwa countdown
        if (seconds > 0) {
            item.setAmount(Math.min(64, Math.max(1, seconds)));
        }
        return item;
    }
}
