package pl.wymiana.command;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import pl.wymiana.Main;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Obsługuje komendę /wymiana oraz jej podkomendy.
 *
 * Składnia:
 *   /wymiana <gracz>                - wysyła zaproszenie
 *   /wymiana akceptuj <gracz>       - akceptuje zaproszenie
 *   /wymiana odrzuc <gracz>         - odrzuca zaproszenie
 *   /wymiana reload                 - przeładowuje konfigurację
 */
public final class CommandWymiana implements CommandExecutor, TabCompleter {

    private final Main plugin;

    public CommandWymiana(Main plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 0) {
            plugin.getMessageManager().sendList(sender, "command.help");
            return true;
        }

        String sub = args[0].toLowerCase();

        // /wymiana reload
        if (sub.equals("reload")) {
            if (!sender.hasPermission(plugin.getConfigManager().getPermissionReload())) {
                plugin.getMessageManager().send(sender, "command.no-permission");
                return true;
            }
            try {
                plugin.reloadAll();
                plugin.getMessageManager().send(sender, "command.reload-success");
                plugin.getLogger().info(plugin.getMessageManager().getRaw("console.reload"));
            } catch (Throwable t) {
                plugin.getMessageManager().send(sender, "command.reload-failure");
                plugin.getLogger().severe("Błąd przeładowania konfiguracji: " + t.getMessage());
            }
            return true;
        }

        // Dalej tylko gracze
        if (!(sender instanceof Player)) {
            plugin.getMessageManager().send(sender, "command.console-only");
            return true;
        }
        Player player = (Player) sender;

        if (!player.hasPermission(plugin.getConfigManager().getPermissionUse())) {
            plugin.getMessageManager().send(player, "command.no-permission");
            return true;
        }

        // /wymiana akceptuj <gracz>
        if (sub.equals("akceptuj")) {
            if (args.length < 2) {
                plugin.getMessageManager().send(player, "command.invalid-usage");
                return true;
            }
            Player target = Bukkit.getPlayer(args[1]);
            if (target == null || !player.canSee(target)) {
                player.sendMessage(plugin.getMessageManager().get("command.player-not-found", player, args[1]));
                plugin.getSoundManager().playError(player);
                return true;
            }
            plugin.getWymianaManager().acceptRequest(player, target);
            return true;
        }

        // /wymiana odrzuc <gracz>
        if (sub.equals("odrzuc")) {
            if (args.length < 2) {
                plugin.getMessageManager().send(player, "command.invalid-usage");
                return true;
            }
            Player target = Bukkit.getPlayer(args[1]);
            if (target == null || !player.canSee(target)) {
                player.sendMessage(plugin.getMessageManager().get("command.player-not-found", player, args[1]));
                plugin.getSoundManager().playError(player);
                return true;
            }
            plugin.getWymianaManager().rejectRequest(player, target);
            return true;
        }

        // /wymiana <gracz> - wysyłanie zaproszenia
        if (args.length == 1) {
            Player target = Bukkit.getPlayer(args[0]);
            if (target == null || !player.canSee(target)) {
                player.sendMessage(plugin.getMessageManager().get("command.player-not-found", player, args[0]));
                plugin.getSoundManager().playError(player);
                return true;
            }
            plugin.getWymianaManager().sendRequest(player, target);
            return true;
        }

        plugin.getMessageManager().send(player, "command.usage");
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        List<String> suggestions = new ArrayList<>();
        if (args.length == 1) {
            String partial = args[0].toLowerCase();
            // Podkomendy
            for (String sub : Arrays.asList("akceptuj", "odrzuc", "reload")) {
                if (sub.startsWith(partial)) suggestions.add(sub);
            }
            // Gracze online
            for (Player p : Bukkit.getOnlinePlayers()) {
                if (p != sender && p.getName().toLowerCase().startsWith(partial)) {
                    suggestions.add(p.getName());
                }
            }
        } else if (args.length == 2) {
            String sub = args[0].toLowerCase();
            if (sub.equals("akceptuj") || sub.equals("odrzuc")) {
                if (!(sender instanceof Player)) return suggestions;
                Player senderPlayer = (Player) sender;
                String partial = args[1].toLowerCase();
                // Gracze, którzy mają oczekujące zaproszenie do tego gracza
                for (Player p : Bukkit.getOnlinePlayers()) {
                    if (p == senderPlayer) continue;
                    if (plugin.getWymianaManager().hasPendingRequest(senderPlayer.getUniqueId(), p.getUniqueId())) {
                        if (p.getName().toLowerCase().startsWith(partial)) {
                            suggestions.add(p.getName());
                        }
                    }
                }
                // Jeśli nie ma pending - zaproponuj wszystkich
                if (suggestions.isEmpty()) {
                    for (Player p : Bukkit.getOnlinePlayers()) {
                        if (p != senderPlayer && p.getName().toLowerCase().startsWith(partial)) {
                            suggestions.add(p.getName());
                        }
                    }
                }
            }
        }
        return suggestions;
    }
}
