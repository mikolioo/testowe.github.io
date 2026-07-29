package pl.wymiana;

import org.bukkit.Bukkit;
import org.bukkit.command.PluginCommand;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import pl.wymiana.command.CommandWymiana;
import pl.wymiana.hook.PlaceholderHook;
import pl.wymiana.listener.InventoryListener;
import pl.wymiana.listener.PlayerListener;
import pl.wymiana.manager.ConfigManager;
import pl.wymiana.manager.GUIManager;
import pl.wymiana.manager.MessageManager;
import pl.wymiana.manager.SoundManager;
import pl.wymiana.manager.WymianaManager;

/**
 * Główna klasa pluginu WymianaSystem.
 */
public final class Main extends JavaPlugin {

    private static Main instance;

    private ConfigManager configManager;
    private MessageManager messageManager;
    private SoundManager soundManager;
    private GUIManager guiManager;
    private WymianaManager wymianaManager;
    private PlaceholderHook placeholderHook;

    /** Czy PlaceholderAPI jest realnie dostępne i włączone w configu. */
    private boolean papiAvailable = false;

    @Override
    public void onEnable() {
        instance = this;

        saveDefaultConfig();
        if (!getDataFolder().exists() && !getDataFolder().mkdirs()) {
            getLogger().warning("Nie udało się utworzyć katalogu danych pluginu.");
        }

        // Kolejność ma znaczenie: config -> messages -> reszta
        this.configManager = new ConfigManager(this);
        this.messageManager = new MessageManager(this);
        this.soundManager = new SoundManager(this);
        this.guiManager = new GUIManager(this);
        this.wymianaManager = new WymianaManager(this);

        registerCommands();
        registerListeners();
        hookPlaceholderAPI();

        wymianaManager.startTasks();

        getLogger().info("WymianaSystem v" + getDescription().getVersion() + " został włączony.");
    }

    @Override
    public void onDisable() {
        // Bezpieczne zakończenie wszystkich aktywnych wymian (zwrot przedmiotów)
        if (wymianaManager != null) {
            try {
                wymianaManager.shutdownAll();
            } catch (Throwable t) {
                getLogger().severe("Błąd podczas zamykania sesji wymiany: " + t.getMessage());
            }
        }
        if (placeholderHook != null) {
            try {
                placeholderHook.unregister();
            } catch (Throwable ignored) {
                // PAPI mogło zostać wyłączone wcześniej
            }
        }
        Bukkit.getScheduler().cancelTasks(this);
        instance = null;
        getLogger().info("WymianaSystem został wyłączony.");
    }

    private void registerCommands() {
        PluginCommand command = getCommand("wymiana");
        if (command == null) {
            getLogger().severe("Nie znaleziono komendy 'wymiana' w plugin.yml! Plugin zostanie wyłączony.");
            Bukkit.getPluginManager().disablePlugin(this);
            return;
        }
        CommandWymiana executor = new CommandWymiana(this);
        command.setExecutor(executor);
        command.setTabCompleter(executor);
    }

    private void registerListeners() {
        Bukkit.getPluginManager().registerEvents(new InventoryListener(this), this);
        Bukkit.getPluginManager().registerEvents(new PlayerListener(this), this);
    }

    private void hookPlaceholderAPI() {
        if (!configManager.isPlaceholderApiEnabled()) return;
        if (Bukkit.getPluginManager().getPlugin("PlaceholderAPI") == null) return;
        try {
            this.placeholderHook = new PlaceholderHook(this);
            if (placeholderHook.register()) {
                this.papiAvailable = true;
                getLogger().info("PlaceholderAPI zostało pomyślnie podłączone.");
            }
        } catch (Throwable t) {
            this.papiAvailable = false;
            getLogger().warning("Nie udało się podłączyć PlaceholderAPI: " + t.getMessage());
        }
    }

    /**
     * Bezpieczne zastosowanie placeholderów PAPI.
     * Klasa PlaceholderAPI jest ładowana wyłącznie gdy plugin jest obecny,
     * dzięki czemu brak PAPI nie powoduje NoClassDefFoundError.
     */
    public String applyPlaceholders(Player player, String text) {
        if (!papiAvailable || player == null || text == null || text.indexOf('%') < 0) {
            return text;
        }
        try {
            return me.clip.placeholderapi.PlaceholderAPI.setPlaceholders(player, text);
        } catch (Throwable t) {
            return text;
        }
    }

    /**
     * Przeładowanie konfiguracji i wiadomości w locie.
     */
    public void reloadAll() {
        configManager.reload();
        messageManager.reload();
    }

    public static Main getInstance() {
        return instance;
    }

    public ConfigManager getConfigManager() {
        return configManager;
    }

    public MessageManager getMessageManager() {
        return messageManager;
    }

    public SoundManager getSoundManager() {
        return soundManager;
    }

    public GUIManager getGUIManager() {
        return guiManager;
    }

    public WymianaManager getWymianaManager() {
        return wymianaManager;
    }

    public boolean isPapiAvailable() {
        return papiAvailable;
    }
}
