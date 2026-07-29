package pl.wymiana.hook;

import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;
import pl.wymiana.Main;
import pl.wymiana.session.WymianaSession;

/**
 * Hook do PlaceholderAPI - zapewnia placeholdery %wymiana_*%.
 */
public final class PlaceholderHook extends PlaceholderExpansion {

    private final Main plugin;

    public PlaceholderHook(Main plugin) {
        this.plugin = plugin;
    }

    @Override
    public @NotNull String getIdentifier() {
        return "wymiana";
    }

    @Override
    public @NotNull String getAuthor() {
        return String.join(", ", plugin.getDescription().getAuthors());
    }

    @Override
    public @NotNull String getVersion() {
        return plugin.getDescription().getVersion();
    }

    @Override
    public boolean persist() {
        return true;
    }

    @Override
    public String onPlaceholderRequest(Player player, @NotNull String params) {
        if (player == null) return "";

        String p = params.toLowerCase();

        switch (p) {
            case "in_trade":
                return String.valueOf(plugin.getWymianaManager().isInSession(player.getUniqueId()));
            case "state": {
                WymianaSession s = plugin.getWymianaManager().getSession(player.getUniqueId());
                return s == null ? "NONE" : s.getState().name();
            }
            case "countdown": {
                WymianaSession s = plugin.getWymianaManager().getSession(player.getUniqueId());
                if (s == null || s.getState() != WymianaSession.State.COUNTDOWN) return "0";
                return String.valueOf(s.getCountdownSeconds());
            }
            case "partner": {
                WymianaSession s = plugin.getWymianaManager().getSession(player.getUniqueId());
                if (s == null) return "";
                java.util.UUID other = s.getOther(player.getUniqueId());
                if (other == null) return "";
                Player op = plugin.getServer().getPlayer(other);
                return op == null ? "" : op.getName();
            }
            case "accepted": {
                WymianaSession s = plugin.getWymianaManager().getSession(player.getUniqueId());
                return s != null && s.isAccepted(player.getUniqueId()) ? "true" : "false";
            }
            default:
                return null;
        }
    }
}
