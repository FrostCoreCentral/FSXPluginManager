import { Message, EmbedBuilder } from 'discord.js';
import FrostSentinelClient from '../../utils/FrostSentinel.js';
import { logger } from '../../utils/Logger.js';

export async function handlePluginCommands(client: FrostSentinelClient, message: Message): Promise<boolean> {
  // Only handle messages starting with ?
  if (!message.content.startsWith('?')) return false;
  if (message.author.bot) return false;
  if (!message.guild) return false;
  if (!client.pluginManager) return false;

  const content = message.content.slice(1);
  const parts = content.split(' ');
  const baseCommand = parts[0]?.toLowerCase();
  const subCommand = parts[1]?.toLowerCase();
  
  if (!baseCommand) return false;

  console.log(`[Plugin Command Handler] Received command: ${baseCommand} from ${message.author.tag} in guild ${message.guild.id}`);

  try {
    // Get loaded plugins for this guild
    const loadedPlugins = (client.pluginManager as any).loadedPlugins.get(message.guild.id);
    
    if (!loadedPlugins) return false;

    // Build full command name: ?ticket create -> "ticket.create"
    let fullCommandName = baseCommand;
    if (subCommand) {
      fullCommandName = `${baseCommand}.${subCommand}`;
    }

    console.log(`[Plugin Command Handler] Looking for command: ${fullCommandName}`);

    // Check if any plugin has this command
    for (const [itemId, plugin] of loadedPlugins) {
      // Check for full command first (ticket.create) or base command (ticket)
      if (plugin.commands.has(fullCommandName) || plugin.commands.has(baseCommand)) {
        const commandName = plugin.commands.has(fullCommandName) ? fullCommandName : baseCommand;
        
        logger.log(`[Plugin Command] Found "${commandName}" in plugin ${plugin.manifest.name}`);
        
        // DON'T call handleCommand here - let PluginManager's event listener handle it
        // Just send the attribution message
        const embed = new EmbedBuilder()
          .setDescription(`🔌 Command executed by plugin: **${plugin.manifest.name}** v${plugin.manifest.version}`)
          .setColor(0x5865F2)
          .setFooter({ text: `Plugin by ${plugin.manifest.author}` });
        
        if (message.channel.isSendable()) {
          await message.channel.send({ embeds: [embed] }).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
          }).catch(() => {});
        }
        
        return true; // Command exists, let PluginManager handle execution
      }
    }

    console.log(`[Plugin Command Handler] No plugin found with command: ${fullCommandName} or ${baseCommand}`);
    return false; // No plugin command found
  } catch (error) {
    logger.error('[Plugin Command Handler] Error executing plugin command', 'pluginCommandHandler', error);
    return false;
  }
}