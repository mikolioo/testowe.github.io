package pl.wymiana.manager;

import org.bukkit.Sound;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import pl.wymiana.Main;

/**
 * Zarządza efektami dźwiękowymi - wszystkie dźwięki są konfigurowalne.
 */
public final class SoundManager {

    private final Main plugin;

    public SoundManager(Main plugin) {
        this.plugin = plugin;
    }

    public void play(Player player, String key) {
        if (player == null) return;
        FileConfiguration cfg = plugin.getConfig();
        String path = "sounds." + key;
        if (!cfg.getBoolean(path + ".enabled", false)) return;
        String name = cfg.getString(path + ".sound", null);
        if (name == null) return;
        float volume = (float) cfg.getDouble(path + ".volume", 1.0);
        float pitch = (float) cfg.getDouble(path + ".pitch", 1.0);
        try {
            Sound sound = Sound.valueOf(name.toUpperCase());
            player.playSound(player.getLocation(), sound, volume, pitch);
        } catch (IllegalArgumentException ignored) {
            // Nieznany dźwięk - ignorujemy
        }
    }

    // Metody skrótowe dla często używanych dźwięków
    public void playRequestSend(Player p)    { play(p, "request-send"); }
    public void playRequestReceive(Player p) { play(p, "request-receive"); }
    public void playRequestExpire(Player p)  { play(p, "request-expire"); }
    public void playAcceptClick(Player p)    { play(p, "accept-click"); }
    public void playConfirmAccept(Player p)  { play(p, "confirm-accept"); }
    public void playTradeSuccess(Player p)   { play(p, "trade-success"); }
    public void playTradeCancel(Player p)    { play(p, "trade-cancel"); }
    public void playCountdownTick(Player p)  { play(p, "countdown-tick"); }
    public void playCountdownEnd(Player p)   { play(p, "countdown-end"); }
    public void playError(Player p)          { play(p, "error"); }
    public void playItemPlace(Player p)      { play(p, "item-place"); }
    public void playResetAccept(Player p)    { play(p, "reset-accept"); }
}
