import {
    Message,
    PermissionFlagsBits,
    TextChannel,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuInteraction,
    ModalSubmitInteraction,
    ButtonInteraction,
} from "discord.js";
import FrostSentinelClient from "../../../utils/FrostSentinel.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ===== TYPE DEFINITIONS =====
interface PluginSetting {
    type: 'string' | 'int' | 'bool';
    description: string;
    default: any;
    value?: any;
}

interface PluginSettings {
    [key: string]: PluginSetting;
}

interface PluginManifest {
    name: string;
    version: string;
    author: string;
    description: string;
}

interface InstalledPlugin {
    itemId: string;
    guildId: string;
    manifest: PluginManifest;
    settings: PluginSettings;
}

interface PluginManager {
    installPluginFromMarketplace(guildId: string, itemId: string): Promise<{ success: boolean; message: string; pluginName?: string }>;
    togglePlugin(guildId: string, itemId: string, enabled: boolean): Promise<{ success: boolean; message: string }>;
    uninstallPlugin(guildId: string, itemId: string): Promise<{ success: boolean; message: string }>;
    getInstalledPlugins(guildId: string): InstalledPlugin[];
}

export const conf = {
    enabled: true,
    guildOnly: true,
    aliases: ["pl"],
    permLevel: "Administrator",
};

export const help = {
    name: "plugin",
    category: "Plugin System",
    description: "Manage custom DSL plugins from the marketplace",
    usage: "plugin <install|enable|disable|list|logs|settings> [itemId]",
};

export async function run(client: FrostSentinelClient, message: Message, args: string[]) {
    if (!message.guild) return;

    const subcommand = args[0]?.toLowerCase();
    const itemId = args[1];

    const pluginManager = (client as any).pluginManager as PluginManager;
    if (!pluginManager) {
        return message.reply("❌ Plugin system is not initialized.");
    }

    switch (subcommand) {
        case "install":
            await handleInstall(message, itemId, pluginManager);
            break;

        case "enable":
            await handleEnable(message, itemId, pluginManager);
            break;

        case "disable":
            await handleDisable(message, itemId, pluginManager);
            break;

        case "list":
            await handleList(message, pluginManager);
            break;

        case "logs":
            await handleLogs(message, itemId);
            break;

        case "settings":
            await handleSettings(message, pluginManager);
            break;

        case "uninstall":
            await handleUninstall(message, itemId, pluginManager);
            break;

        default:
            return message.reply(
                "❌ Invalid subcommand. Usage:\n" +
                "```\n" +
                "?plugin install <itemId>   - Install a plugin from marketplace\n" +
                "?plugin enable <itemId>    - Enable an installed plugin\n" +
                "?plugin disable <itemId>   - Disable an installed plugin\n" +
                "?plugin uninstall <itemId> - Uninstall a plugin\n" +
                "?plugin list               - List all installed plugins\n" +
                "?plugin logs <itemId>      - View plugin execution logs\n" +
                "?plugin settings           - Configure plugin settings\n" +
                "```"
            );
    }
}

// ===== INSTALL PLUGIN =====
async function handleInstall(message: Message, itemId: string | undefined, pluginManager: PluginManager) {
    if (!itemId) {
        return message.reply("❌ You must provide a plugin itemId. Usage: `?plugin install <itemId>`");
    }

    if (!message.guild) return;

    const reply = await message.reply("⏳ Installing plugin from marketplace...");

    try {
        // Check if plugin exists in marketplace
        const marketplaceItem = await prisma.marketplaceItem.findUnique({
            where: { itemId }
        });

        if (!marketplaceItem) {
            return reply.edit("❌ Plugin not found in marketplace. Please check the itemId.");
        }

        if (marketplaceItem.status !== "approved") {
            return reply.edit("❌ This plugin is not approved for installation.");
        }

        // Check if already installed
        const existingInstall = await prisma.installedPlugin.findUnique({
            where: {
                guildId_itemId: {
                    guildId: message.guild.id,
                    itemId: itemId
                }
            }
        });

        if (existingInstall) {
            return reply.edit("❌ This plugin is already installed in this server.");
        }

        // Install plugin
        const result = await pluginManager.installPluginFromMarketplace(message.guild.id, itemId);

        if (!result.success) {
            return reply.edit(`❌ Installation failed: ${result.message}`);
        }

        // Save to database
        await prisma.installedPlugin.create({
            data: {
                guildId: message.guild.id,
                itemId: itemId,
                pluginName: result.pluginName || marketplaceItem.title,
                enabled: true,
                installedAt: new Date(),
                installedBy: message.author.id,
            }
        });

        // Increment download count
        await prisma.marketplaceItem.update({
            where: { itemId },
            data: { downloads: { increment: 1 } }
        });

        const embed = new EmbedBuilder()
            .setTitle("✅ Plugin Installed Successfully")
            .setDescription(`**${marketplaceItem.title}** v${marketplaceItem.version}`)
            .addFields(
                { name: "Author", value: marketplaceItem.authorName, inline: true },
                { name: "Item ID", value: itemId, inline: true },
                { name: "Status", value: "✅ Enabled", inline: true }
            )
            .setColor("Green")
            .setFooter({ text: `Installed by ${message.author.tag}` })
            .setTimestamp();

        await reply.edit({ content: null, embeds: [embed] });

        // Log installation
        await prisma.pluginLog.create({
            data: {
                guildId: message.guild.id,
                itemId: itemId,
                action: "INSTALL",
                userId: message.author.id,
                details: `Plugin ${marketplaceItem.title} installed`,
                timestamp: new Date(),
            }
        });

    } catch (error) {
        console.error("Plugin install error:", error);
        return reply.edit(`❌ An error occurred during installation: ${error}`);
    }
}

// ===== ENABLE PLUGIN =====
async function handleEnable(message: Message, itemId: string | undefined, pluginManager: PluginManager) {
    if (!itemId) {
        return message.reply("❌ You must provide a plugin itemId. Usage: `?plugin enable <itemId>`");
    }

    if (!message.guild) return;

    try {
        const installed = await prisma.installedPlugin.findUnique({
            where: {
                guildId_itemId: {
                    guildId: message.guild.id,
                    itemId: itemId
                }
            }
        });

        if (!installed) {
            return message.reply("❌ This plugin is not installed in this server.");
        }

        if (installed.enabled) {
            return message.reply("❌ This plugin is already enabled.");
        }

        // Enable in plugin manager
        const result = await pluginManager.togglePlugin(message.guild.id, itemId, true);

        if (!result.success) {
            return message.reply(`❌ Failed to enable plugin: ${result.message}`);
        }

        // Update database
        await prisma.installedPlugin.update({
            where: {
                guildId_itemId: {
                    guildId: message.guild.id,
                    itemId: itemId
                }
            },
            data: { enabled: true }
        });

        // Log action
        await prisma.pluginLog.create({
            data: {
                guildId: message.guild.id,
                itemId: itemId,
                action: "ENABLE",
                userId: message.author.id,
                details: `Plugin ${installed.pluginName} enabled`,
                timestamp: new Date(),
            }
        });

        const embed = new EmbedBuilder()
            .setTitle("✅ Plugin Enabled")
            .setDescription(`**${installed.pluginName}** is now active`)
            .setColor("Green")
            .setTimestamp();

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error("Plugin enable error:", error);
        return message.reply(`❌ An error occurred: ${error}`);
    }
}

// ===== DISABLE PLUGIN =====
async function handleDisable(message: Message, itemId: string | undefined, pluginManager: PluginManager) {
    if (!itemId) {
        return message.reply("❌ You must provide a plugin itemId. Usage: `?plugin disable <itemId>`");
    }

    if (!message.guild) return;

    try {
        const installed = await prisma.installedPlugin.findUnique({
            where: {
                guildId_itemId: {
                    guildId: message.guild.id,
                    itemId: itemId
                }
            }
        });

        if (!installed) {
            return message.reply("❌ This plugin is not installed in this server.");
        }

        if (!installed.enabled) {
            return message.reply("❌ This plugin is already disabled.");
        }

        // Disable in plugin manager
        const result = await pluginManager.togglePlugin(message.guild.id, itemId, false);

        if (!result.success) {
            return message.reply(`❌ Failed to disable plugin: ${result.message}`);
        }

        // Update database
        await prisma.installedPlugin.update({
            where: {
                guildId_itemId: {
                    guildId: message.guild.id,
                    itemId: itemId
                }
            },
            data: { enabled: false }
        });

        // Log action
        await prisma.pluginLog.create({
            data: {
                guildId: message.guild.id,
                itemId: itemId,
                action: "DISABLE",
                userId: message.author.id,
                details: `Plugin ${installed.pluginName} disabled`,
                timestamp: new Date(),
            }
        });

        const embed = new EmbedBuilder()
            .setTitle("❌ Plugin Disabled")
            .setDescription(`**${installed.pluginName}** is now inactive`)
            .setColor("Red")
            .setTimestamp();

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error("Plugin disable error:", error);
        return message.reply(`❌ An error occurred: ${error}`);
    }
}

// ===== UNINSTALL PLUGIN =====
async function handleUninstall(message: Message, itemId: string | undefined, pluginManager: PluginManager) {
    if (!itemId) {
        return message.reply("❌ You must provide a plugin itemId. Usage: `?plugin uninstall <itemId>`");
    }

    if (!message.guild) return;

    try {
        const installed = await prisma.installedPlugin.findUnique({
            where: {
                guildId_itemId: {
                    guildId: message.guild.id,
                    itemId: itemId
                }
            }
        });

        if (!installed) {
            return message.reply("❌ This plugin is not installed in this server.");
        }

        // Uninstall from plugin manager
        const result = await pluginManager.uninstallPlugin(message.guild.id, itemId);

        if (!result.success) {
            return message.reply(`❌ Failed to uninstall plugin: ${result.message}`);
        }

        // Remove from database
        await prisma.installedPlugin.delete({
            where: {
                guildId_itemId: {
                    guildId: message.guild.id,
                    itemId: itemId
                }
            }
        });

        // Log action
        await prisma.pluginLog.create({
            data: {
                guildId: message.guild.id,
                itemId: itemId,
                action: "UNINSTALL",
                userId: message.author.id,
                details: `Plugin ${installed.pluginName} uninstalled`,
                timestamp: new Date(),
            }
        });

        const embed = new EmbedBuilder()
            .setTitle("🗑️ Plugin Uninstalled")
            .setDescription(`**${installed.pluginName}** has been removed from this server`)
            .setColor("Orange")
            .setTimestamp();

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error("Plugin uninstall error:", error);
        return message.reply(`❌ An error occurred: ${error}`);
    }
}

// ===== LIST PLUGINS =====
async function handleList(message: Message, pluginManager: PluginManager) {
    if (!message.guild) return;

    try {
        const installedPlugins = await prisma.installedPlugin.findMany({
            where: { guildId: message.guild.id }
        });

        if (installedPlugins.length === 0) {
            return message.reply("❌ No plugins installed in this server. Use `?plugin install <itemId>` to install one.");
        }

        const embed = new EmbedBuilder()
            .setTitle("📦 Installed Plugins")
            .setDescription(`Total: ${installedPlugins.length}`)
            .setColor("Blue")
            .setTimestamp();

        for (const plugin of installedPlugins) {
            const status = plugin.enabled ? "✅ Enabled" : "❌ Disabled";
            embed.addFields({
                name: plugin.pluginName,
                value: `**ID:** \`${plugin.itemId}\`\n**Status:** ${status}\n**Installed:** <t:${Math.floor(plugin.installedAt.getTime() / 1000)}:R>`,
                inline: false
            });
        }

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error("Plugin list error:", error);
        return message.reply(`❌ An error occurred: ${error}`);
    }
}

// ===== VIEW LOGS =====
async function handleLogs(message: Message, itemId: string | undefined) {
    if (!itemId) {
        return message.reply("❌ You must provide a plugin itemId. Usage: `?plugin logs <itemId>`");
    }

    if (!message.guild) return;

    try {
        const logs = await prisma.pluginLog.findMany({
            where: {
                guildId: message.guild.id,
                itemId: itemId
            },
            orderBy: { timestamp: 'desc' },
            take: 10
        });

        if (logs.length === 0) {
            return message.reply("❌ No logs found for this plugin.");
        }

        const embed = new EmbedBuilder()
            .setTitle("📋 Plugin Logs")
            .setDescription(`Recent activity for plugin \`${itemId}\``)
            .setColor("Purple")
            .setTimestamp();

        for (const log of logs) {
            const user = await message.client.users.fetch(log.userId).catch(() => null);
            const userTag = user ? user.tag : "Unknown User";

            embed.addFields({
                name: `${log.action} - <t:${Math.floor(log.timestamp.getTime() / 1000)}:R>`,
                value: `**By:** ${userTag}\n**Details:** ${log.details}`,
                inline: false
            });
        }

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error("Plugin logs error:", error);
        return message.reply(`❌ An error occurred: ${error}`);
    }
}

// ===== SETTINGS MENU WITH PAGINATION =====
async function handleSettings(message: Message, pluginManager: PluginManager) {
    if (!message.guild) return;

    try {
        const installedPlugins = await prisma.installedPlugin.findMany({
            where: { 
                guildId: message.guild.id,
                enabled: true 
            }
        });

        if (installedPlugins.length === 0) {
            return message.reply("❌ No enabled plugins found. Enable a plugin first using `?plugin enable <itemId>`");
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`plugin_settings_${message.author.id}`)
            .setPlaceholder("Select a plugin to configure")
            .addOptions(
                installedPlugins.map(plugin => ({
                    label: plugin.pluginName,
                    description: `Configure ${plugin.pluginName} settings`,
                    value: plugin.itemId
                }))
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        const reply = await message.reply({
            content: "**⚙️ Plugin Settings**\nSelect a plugin to configure its settings:",
            components: [row]
        });

        // Create a client-level listener for all interactions from this user
        const filter = (interaction: any) => interaction.user.id === message.author.id;
        
        // Listen for select menu and modal interactions
        const selectCollector = message.client.on('interactionCreate', async (interaction: any) => {
            if (!filter(interaction)) return;
            
            try {
                if (interaction.customId?.includes(`plugin_settings_${message.author.id}`)) {
                    if (interaction.isStringSelectMenu()) {
                        await handleSettingsSelect(interaction, pluginManager, message.author.id);
                    }
                } else if (interaction.customId?.startsWith(`edit_setting_`)) {
                    if (interaction.isButton()) {
                        await handleSettingsPagination(interaction, pluginManager, message.author.id);
                    }
                } else if (interaction.customId?.startsWith(`plugin_settings_modal_`)) {
                    if (interaction.isModalSubmit()) {
                        await handleSettingsModal(interaction, pluginManager);
                    }
                }
            } catch (error) {
                console.error("Settings interaction error:", error);
                if (!interaction.replied) {
                    await interaction.reply({ 
                        content: `❌ An error occurred: ${error}`, 
                        ephemeral: true 
                    }).catch(() => null);
                }
            }
        });

    } catch (error) {
        console.error("Plugin settings error:", error);
        return message.reply(`❌ An error occurred: ${error}`);
    }
}

async function handleSettingsSelect(interaction: StringSelectMenuInteraction, pluginManager: PluginManager, userId: string) {
    const itemId = interaction.values[0];
    if (!interaction.guild) return;

    const plugin = pluginManager.getInstalledPlugins(interaction.guild.id).find((p: InstalledPlugin) => p.itemId === itemId);
    if (!plugin) {
        return interaction.reply({ content: "❌ Plugin not found.", ephemeral: true });
    }

    // Show current settings overview
    await showSettingsOverview(interaction, plugin, itemId, userId);
}

async function showSettingsOverview(interaction: StringSelectMenuInteraction | ButtonInteraction, plugin: any, itemId: string, userId: string) {
    const settings = Object.entries(plugin.settings);
    const totalPages = Math.ceil(settings.length / 5);
    
    const embed = new EmbedBuilder()
        .setTitle(`⚙️ ${plugin.manifest.name} - Settings Overview`)
        .setDescription(`Total Settings: ${settings.length}`)
        .setColor("Blue")
        .setFooter({ text: `Page 1 of ${totalPages}` });

    // Show first 5 settings
    settings.slice(0, 5).forEach(([key, setting]) => {
        const typedSetting = setting as PluginSetting;
        const currentValue = typedSetting.value ?? typedSetting.default;
        embed.addFields({
            name: key,
            value: `**Type:** ${typedSetting.type}\n**Current Value:** \`${currentValue}\`\n**Description:** ${typedSetting.description || 'No description'}`,
            inline: false
        });
    });

    // Build pagination and action buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>();
    
    // Edit settings button
    buttons.addComponents(
        new ButtonBuilder()
            .setCustomId(`edit_setting_${itemId}_${userId}_0`)
            .setLabel("Edit Settings")
            .setStyle(ButtonStyle.Primary)
    );

    if (totalPages > 1) {
        buttons.addComponents(
            new ButtonBuilder()
                .setCustomId(`next_page_${itemId}_${userId}_1`)
                .setLabel("Next Page")
                .setStyle(ButtonStyle.Secondary)
        );
    }

    if (interaction.isStringSelectMenu()) {
        await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: true });
    } else if (interaction.isButton()) {
        await interaction.update({ embeds: [embed], components: [buttons] });
    }
}

async function handleSettingsPagination(interaction: ButtonInteraction, pluginManager: PluginManager, userId: string) {
    const customId = interaction.customId;
    
    if (customId.startsWith('edit_setting_')) {
        const parts = customId.split('_');
        const itemId = parts[2];
        const pageNum = parseInt(parts[4]) || 0;

        if (!interaction.guild) return;

        const plugin = pluginManager.getInstalledPlugins(interaction.guild.id).find((p: InstalledPlugin) => p.itemId === itemId);
        if (!plugin) {
            return interaction.reply({ content: "❌ Plugin not found.", ephemeral: true });
        }

        // Show the settings form modal
        await showSettingsForm(interaction, plugin, itemId, pageNum);
    }
}

async function showSettingsForm(interaction: StringSelectMenuInteraction | ButtonInteraction, plugin: InstalledPlugin, itemId: string, page: number) {
    const settings = Object.entries(plugin.settings);
    const pageSize = 5;
    const startIdx = page * pageSize;
    const pageSettings = settings.slice(startIdx, startIdx + pageSize);
    const totalPages = Math.ceil(settings.length / pageSize);

    const modal = new ModalBuilder()
        .setCustomId(`plugin_settings_modal_${itemId}_${page}`)
        .setTitle(`${plugin.manifest.name} - Page ${page + 1} of ${totalPages}`);

    for (const [key, setting] of pageSettings) {
        const typedSetting = setting as PluginSetting;
        const input = new TextInputBuilder()
            .setCustomId(`setting_${key}`)
            .setLabel(key.substring(0, 45)) // Discord has 45 char limit for label
            .setStyle(TextInputStyle.Short)
            .setValue(String(typedSetting.value ?? typedSetting.default ?? ''))
            .setRequired(false);

        if (typedSetting.description) {
            input.setPlaceholder(typedSetting.description.substring(0, 100));
        }

        const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
        modal.addComponents(actionRow);
    }

    await interaction.showModal(modal);
}

async function handleSettingsModal(interaction: ModalSubmitInteraction, pluginManager: PluginManager) {
    const customId = interaction.customId;
    const itemId = customId.replace('plugin_settings_modal_', '').split('_')[0];
    
    if (!interaction.guild) return;

    const plugin = pluginManager.getInstalledPlugins(interaction.guild.id).find((p: InstalledPlugin) => p.itemId === itemId);
    if (!plugin) {
        return interaction.reply({ content: "❌ Plugin not found.", ephemeral: true });
    }

    const updates: Record<string, any> = {};
    let updatedCount = 0;

    for (const [key, setting] of Object.entries(plugin.settings)) {
        const typedSetting = setting as PluginSetting;
        try {
            const value = interaction.fields.getTextInputValue(`setting_${key}`).trim();
            
            // Only update if value is provided
            if (value) {
                if (typedSetting.type === 'int') {
                    const intValue = parseInt(value);
                    if (isNaN(intValue)) {
                        continue; // Skip invalid integers
                    }
                    updates[key] = intValue;
                } else if (typedSetting.type === 'bool') {
                    updates[key] = value.toLowerCase() === 'true' || value === '1';
                } else {
                    updates[key] = value;
                }
                updatedCount++;
            }
        } catch (error) {
            // Field doesn't exist on this page, skip
            continue;
        }
    }

    // Update settings in plugin manager
    for (const [key, value] of Object.entries(updates)) {
        if (plugin.settings[key]) {
            plugin.settings[key].value = value;
        }
    }

    // Save settings to database
    if (updatedCount > 0) {
        try {
            // Store settings as JSON in the database
            const settingsJson = JSON.stringify(Object.fromEntries(
                Object.entries(plugin.settings).map(([k, v]: [string, PluginSetting]) => [k, v.value])
            ));

            await prisma.installedPlugin.update({
                where: {
                    guildId_itemId: {
                        guildId: interaction.guild!.id,
                        itemId: itemId
                    }
                },
                data: {
                    settings: settingsJson as any // Store as JSON string
                }
            });
        } catch (err) {
            console.error('Failed to save plugin settings to database:', err);
        }
    }

    // Log settings change
    if (updatedCount > 0) {
        await prisma.pluginLog.create({
            data: {
                guildId: interaction.guild!.id,
                itemId: itemId,
                action: "SETTINGS_UPDATE",
                userId: interaction.user.id,
                details: `Updated ${updatedCount} settings: ${Object.keys(updates).join(', ')}`,
                timestamp: new Date(),
            }
        });
    }

    const embed = new EmbedBuilder()
        .setTitle("✅ Settings Updated")
        .setDescription(`${updatedCount} setting(s) for **${plugin.manifest.name}** have been updated`)
        .addFields({
            name: "Updated Settings",
            value: Object.entries(updates)
                .map(([k, v]) => `\`${k}\` → \`${v}\``)
                .join('\n') || "No changes made"
        })
        .setColor("Green")
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}