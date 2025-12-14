import { ButtonInteraction, ChannelType } from "discord.js";
import FrostSentinelClient from "./FrostSentinel";

export default async (client: FrostSentinelClient, interaction: ButtonInteraction) => {
  if (!interaction.isButton()) return;

  const buttonId = interaction.customId;
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: "❌ This button can only be used in a server.", ephemeral: true });
    return;
  }

  const pluginManager = (client as any).pluginManager;
  if (!pluginManager) {
    await interaction.reply({ content: "❌ Plugin system is not initialized.", ephemeral: true });
    return;
  }

  try {
    // Find the plugin that has this button handler
    const plugins = pluginManager.loadedPlugins.get(guildId);
    if (!plugins) {
      console.log(`[buttonHandler] No plugins loaded for guild ${guildId}`);
      return;
    }

    // Search through all plugins for a button handler matching this ID
    let found = false;
    for (const [itemId, plugin] of plugins) {
      const handler = plugin.buttonHandlers.get(buttonId);
      if (handler) {
        found = true;
        console.log(`[buttonHandler] Found button handler "${buttonId}" in plugin ${itemId}`);

        // Check cooldown
        if (handler.cooldown) {
          const cooldownKey = `button_${buttonId}_${interaction.user.id}`;
          const now = Date.now();
          const cooldowns = (client as any).cooldowns || new Map();
          const expirationTime = cooldowns.get(cooldownKey) || 0;

          if (now < expirationTime) {
            const remaining = Math.ceil((expirationTime - now) / 1000);
            await interaction.reply({
              content: `⏱️ This button is on cooldown for ${remaining} more second(s).`,
              ephemeral: true
            });
            return;
          }

          // Set cooldown
          cooldowns.set(cooldownKey, now + handler.cooldown * 1000);
          (client as any).cooldowns = cooldowns;
        }

        // Create context for the button handler
        const context = {
          interaction: {
            id: interaction.id,
            user: {
              id: interaction.user.id,
              username: interaction.user.username
            },
            member: interaction.member ? {
              id: interaction.member.user.id,
              roles: interaction.member.roles instanceof Object ? Object.keys(interaction.member.roles) : []
            } : null,
            guild_id: guildId,
            channel_id: interaction.channelId,
            author: interaction.user,
            respond: async (content: any) => {
              try {
                if (interaction.replied) {
                  await interaction.followUp({
                    content: typeof content === 'string' ? content : undefined,
                    embeds: typeof content !== 'string' ? [content] : undefined,
                    ephemeral: true
                  });
                } else {
                  await interaction.reply({
                    content: typeof content === 'string' ? content : undefined,
                    embeds: typeof content !== 'string' ? [content] : undefined,
                    ephemeral: true
                  });
                }
              } catch (err) {
                console.error('[buttonHandler] Error responding to interaction:', err);
              }
            }
          },
          message: undefined,
          parameters: {}
        };

        // Get the executeCode method from pluginManager
        // Since it's private, we need to call it through the plugin's vm
        // Better approach: let's expose it or use reflection
        console.log(`[buttonHandler] Executing button handler code for "${buttonId}"`);
        
        try {
          // Call the public executePluginCode method
          await pluginManager.executePluginCode(guildId, itemId, handler.execute, context);
        } catch (err) {
          console.error(`[buttonHandler] Error executing button handler:`, err);
          await interaction.reply({
            content: "❌ An error occurred while processing this button.",
            ephemeral: true
          });
        }
        break;
      }
    }

    if (!found) {
      console.warn(`[buttonHandler] No button handler found for button ID: "${buttonId}"`);
    }
  } catch (error) {
    console.error('[buttonHandler] Error handling button interaction:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while processing this button.",
          ephemeral: true
        });
      }
    } catch (err) {
      console.error('[buttonHandler] Failed to send error response:', err);
    }
  }
};