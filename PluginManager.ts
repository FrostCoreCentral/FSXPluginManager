import { Client, Message, ButtonInteraction, TextChannel, ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { VM } from 'vm2';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ===== TYPES =====
interface HttpRequestLog {
  timestamp: Date;
  method: string;
  url: string;
  status?: number;
  responseSize: number;
  duration: number;
  pluginId: string;
  guildId: string;
  success: boolean;
  errorReason?: string;
}

interface PluginManifest {
  name: string; version: string; author: string; description: string;
  tags: string[]; scopes: string[]; price: number; homepage: string;
  iconUrl: string; license: string; faq: string;
}

interface PluginSettings {
  [key: string]: { type: 'string' | 'int' | 'bool'; description: string; default: any; value?: any; };
}

interface InstalledPlugin {
  itemId: string; guildId: string; manifest: PluginManifest; dslCode: string;
  settings: PluginSettings; installedAt: Date; enabled: boolean;
  imports: string[]; // Track required imports
}

interface LoadedPlugin {
  itemId: string; manifest: PluginManifest; dslCode: string; settings: PluginSettings;
  commands: Map<string, CommandHandler>; buttonHandlers: Map<string, ButtonHandler>;
  eventHandlers: EventHandlers; customFunctions: Map<string, any>; logicHandlers: LogicHandler[]; 
  vm: VM; imports: string[]; // Required imports
}

interface CommandHandler {
  description: string; usage: string; parameters: Map<string, ParameterDef>;
  cooldown?: number; userPermissions?: string[]; botPermissions?: string[];
  onCommand: string; onCooldown?: string; onPermissionDeniedUser?: string; onPermissionDeniedBot?: string;
}

interface ParameterDef { type: 'string' | 'int' | 'bool'; description: string; required: boolean; }
interface ButtonHandler { cooldown?: number; execute: string; onCooldown?: string; }
interface EventHandlers {
  onLoad?: string[]; onMemberJoin?: string[]; onMemberLeave?: string[];
  onMemberUpdate?: string[]; onMessageDelete?: string[]; onVoiceStateChange?: string[];
  onReaction?: string[]; onSettingChange?: string[]; customEvents?: Map<string, string[]>;
}
interface LogicHandler { 
  pattern: string; 
  action: string; 
  type: 'on_listen' | 'on_trigger'; // Track if it's a listener or trigger handler
}

// ===== MODULE REQUIREMENTS MAP =====
// Maps DSL features to required scopes (not use statements)
const MODULE_REQUIREMENTS: { [key: string]: string[] } = {
  // Button operations
  'buttons.create_button': ['buttons.use'],
  'buttons.create': ['buttons.use'],
  'on_click': ['buttons.use'],
  'interactions.create': ['buttons.use'],
  
  // Database operations
  'db.set': ['db.write'],
  'db.use': ['db.read'],
  'db.send': ['messages.send'],
  'db.insert': ['db.write'],
  'db.update': ['db.write'],
  'db.delete': ['db.write'],
  'db.query': ['db.read'],
  'db.query_one': ['db.read'],
  
  // Guild/Channel operations
  'guilds.send': ['messages.send'],
  'guilds.create_channel': ['channels.create'],
  'guilds.fetch_channel': ['channels.read'],
  'guilds.fetch': ['channels.read'],
  'channel.delete': ['channels.delete'],
  'channel.send': ['messages.send'],
  
  // Embed operations
  'embeds.create': ['messages.send'],
  
  // Voice operations
  'fastlink.connect': ['voice.connect'],
  
  // User operations
  'users.get': ['messages.send'], // Users are typically accessed in message context
  'users.fetch': ['messages.send'],
  
  // Permission checks
  'user_has_permission': ['messages.send'], // Permission checks are part of message handling
  'discord.permissions.has': ['messages.send'],
  
  // Events
  'on_member_join': ['messages.send'], // Sending welcome messages
  'on_member_leave': ['messages.send'],
  'on_member_update': ['messages.send'],
  'on_message_delete': ['messages.send'],
  'on_voice_state_change': ['voice.connect'],
  'on_reaction': ['events.reaction'],
  'on_setting': ['messages.send'],
  'on_load': ['db.read', 'db.write'], // Typically used for DB setup
  
  // Logic and utilities
  'emit.trigger': ['messages.send'], // Triggers typically result in messages
  'cooldown.is_on': ['messages.send'],
  'cooldown.remaining': ['messages.send'],
  'cooldown.set': ['messages.send'],
  'time.now': ['messages.send'],
  'math.random_int': ['messages.send'],
  
  // Custom events
  'event ': ['messages.send'], // Custom events typically send messages
  'logic': ['messages.send']
};

// ===== UTILITY: Extract block content between braces =====
function extractBlockContent(text: string, startIndex: number): { content: string; endIndex: number } {
  let depth = 0;
  let i = startIndex;
  let foundOpening = false;
  
  for (; i < text.length; i++) {
    if (text[i] === '{') {
      depth++;
      foundOpening = true;
      i++;
      break;
    }
  }
  
  if (!foundOpening) {
    return { content: '', endIndex: startIndex };
  }
  
  const contentStart = i;
  
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  
  const content = text.substring(contentStart, i).trim();
  return { content, endIndex: i + 1 };
}

// ===== IMPORT VALIDATOR =====
class ImportValidator {
  static validate(dslCode: string, declaredImports: string[], scopes: string[]): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const requiredScopes = new Set<string>();
    
    // Extract all features used in the code
    for (const [feature, required] of Object.entries(MODULE_REQUIREMENTS)) {
      if (dslCode.includes(feature)) {
        console.log(`[ImportValidator] Found feature: ${feature}, requires scopes: ${required.join(', ')}`);
        required.forEach(scope => requiredScopes.add(scope));
      }
    }
    
    // Check if all required scopes are declared in manifest
    const missingScopes: string[] = [];
    for (const required of requiredScopes) {
      if (!scopes.includes(required)) {
        missingScopes.push(required);
      }
    }
    
    if (missingScopes.length > 0) {
      errors.push(`Missing required scopes in manifest: ${missingScopes.join(', ')}`);
    }
    
    // Check for unused use statements (just warnings, not errors)
    const usedModules = new Set<string>();
    for (const [feature] of Object.entries(MODULE_REQUIREMENTS)) {
      if (dslCode.includes(feature)) {
        // Extract module prefix from feature (e.g., "db.insert" -> "db")
        const parts = feature.split('.');
        if (parts.length > 1) {
          usedModules.add(parts[0]);
        }
      }
    }
    
    const unusedImports: string[] = [];
    for (const declared of declaredImports) {
      const modulePrefix = declared.split('.')[0];
      if (!usedModules.has(modulePrefix) && !usedModules.has(declared)) {
        unusedImports.push(declared);
      }
    }
    
    if (unusedImports.length > 0) {
      warnings.push(`Unused 'use' statements (can be removed): ${unusedImports.join(', ')}`);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  static extractImports(dslCode: string): string[] {
    const imports: string[] = [];
    const regex = /use\s+([\w.]+)/g;
    let match;
    
    while ((match = regex.exec(dslCode)) !== null) {
      imports.push(match[1]);
    }
    
    console.log(`[ImportValidator] Extracted use statements:`, imports);
    return imports;
  }
}

// ===== DSL TRANSPILER =====
class DSLTranspiler {
  static transpile(dslCode: string, context: any): string {
    let js = dslCode;
    
    // Strip single-line comments first
    js = js.replace(/\/\/.*$/gm, '');
    
    // 1. Replace DSL keywords
    js = js.replace(/\blet\b/g, 'const');
    js = js.replace(/\band\b/g, '&&');
    js = js.replace(/\bor\b/g, '||');
    js = js.replace(/\bnot\b/g, '!');
    
    // 2. Replace DSL operators
    js = js.replace(/\s===\s/g, ' === ');
    js = js.replace(/\s==\s/g, ' === ');
    js = js.replace(/\s!==\s/g, ' !== ');
    js = js.replace(/\s!=\s/g, ' !== ');

    // 3. Replace custom functions and DSL syntax
    js = this.replaceCustomFunctions(js);
    
    // 4. Handle function calls that need await
    js = this.addAwaitToAsyncCalls(js);
    
    // 5. Replace message/interaction object references
    js = js.replace(/message\.channel_id/g, 'message.channelId');
    js = js.replace(/message\.guild_id/g, 'message.guildId');
    js = js.replace(/message\.author\.id/g, 'message.author.id');
    js = js.replace(/message\.author\.username/g, 'message.author.username');
    
    // 6. Add context variables at the top
    const messageObj = context.message ? {
      channelId: context.message.channelId || context.channel_id,
      guildId: context.message.guildId || context.guild_id,
      author: context.message.author || { id: '', username: '' },
      content: context.message.content || '',
      id: context.message.id || '',
      channel: context.message.channel || { name: '' }
    } : {
      channelId: context.channel_id,
      guildId: context.guild_id,
      author: { id: '', username: '' },
      content: '',
      id: '',
      channel: { name: '' }
    };

    const trimmedCode = js.trim();

    js = `
        const message = ${JSON.stringify(messageObj)};
        const parameters = ${JSON.stringify(context.parameters || {})};
        const guild_id = "${context.guild_id || ''}";
        const channel_id = "${context.channel_id || ''}";
        
        // Add message.react() helper
        message.react = async (emoji) => {
          if (!message.id || !message.channelId) {
            console.warn('[message.react] No message ID or channel ID available');
            return;
          }
          await msg.react(message.channelId, message.id, emoji);
        };
        
        ${trimmedCode}
`;
    
    return js;
  }
  
  private static addAwaitToAsyncCalls(js: string): string {
    const asyncFunctions = [
      'db.insert', 'db.update', 'db.delete', 'db.query', 'db.query_one', 'db.use', 'db.set', 'db.send',
      'guilds.send', 'guilds.create_channel', 'guilds.fetch', 'guilds.fetch_channel',
      'users.get', 'users.fetch',
      'time.now',
      'fastlink.connect',
      'emit.trigger'
    ];
    
    for (const func of asyncFunctions) {
      const escapedFunc = func.replace(/\./g, '\\.');
      const regex = new RegExp(`(?<!await )\\b${escapedFunc}\\s*\\(`, 'g');
      js = js.replace(regex, `await ${func}(`);
    }
    
    const asyncMethods = ['send', 'create_channel', 'delete', 'fetch'];
    
    for (const method of asyncMethods) {
      const regex = new RegExp(`(?<!await )\\b([a-zA-Z_]\\w*)\\.${method}\\s*\\(`, 'g');
      
      js = js.replace(regex, (match, varName) => {
        if (['guilds', 'users', 'db'].includes(varName)) {
          return match;
        }
        return `await ${varName}.${method}(`;
      });
    }
    
    return js;
  }
  
  private static replaceCustomFunctions(js: string): string {
    // Handle try/catch
    js = js.replace(/\bcatch\s+(\w+)\s*{/g, (match, varName) => {
      return `catch (${varName.trim()}) {`;
    });
    
    // Handle if statements
    js = js.replace(/\bif\s+([^{]+)\s*(?:->\s*)?{/g, (match, condition) => {
      return `if (${condition.trim()}) {`;
    });
    
    // Handle emit.trigger with typed format: emit.trigger(event:name, {...})
    // Support dotted names like command:ticket.close
    js = js.replace(/emit\.trigger\s*\(\s*(event|fun|command):([\w.]+)\s*,?\s*([^)]*)\)/g, (match, type, name, data) => {
      const dataArg = data.trim() || '{}';
      return `emit.trigger("${type}:${name}", ${dataArg})`;
    });
    
    // error_embed
    js = js.replace(/error_embed\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g, (match, title, desc) => {
      return `(() => { const e = embeds.create(); e.set_title("${title}"); e.set_description("${desc}"); e.set_color(0xFF0000); return e.build(); })()`;
    });
    
    // success_embed
    js = js.replace(/success_embed\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g, (match, title, desc) => {
      return `(() => { const e = embeds.create(); e.set_title("${title}"); e.set_description("${desc}"); e.set_color(0x00FF00); return e.build(); })()`;
    });
    
    // format_user_tag
    js = js.replace(/format_user_tag\s*\(\s*([^,]+)\s*,\s*[^)]+\s*\)/g, '$1');
    
    // format_time_span
    js = js.replace(/format_time_span\s*\(\s*(\w+)\s*\)/g, (match, varName) => {
      return `(() => { const ms = ${varName}; const s = Math.floor(ms/1000); return \`\${s}s\`; })()`;
    });
    
    // btn
    js = js.replace(/btn\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g, (match, label, id, style) => {
      return `buttons.create_button("${label}", "${id}", "${style}")`;
    });
    
    // String methods
    js = js.replace(/\.to_lower\(\)/g, '.toLowerCase()');
    js = js.replace(/\.to_upper\(\)/g, '.toUpperCase()');
    js = js.replace(/\.contains\(/g, '.includes(');
    js = js.replace(/\.starts_with\(/g, '.startsWith(');
    js = js.replace(/\.ends_with\(/g, '.endsWith(');
    // Note: .split() is already valid JavaScript, no replacement needed
    
    return js;
  }
}

export class PluginManager {
  private client: Client;
  private installedPlugins: Map<string, InstalledPlugin[]>;
  private loadedPlugins: Map<string, Map<string, LoadedPlugin>>;
  private cooldowns: Map<string, number>;
  
  // HTTP Monitoring
  private httpLogs: Map<string, HttpRequestLog[]> = new Map();
  private blockedDomains: Set<string> = new Set();
  private requestLimits = {
    maxRequestsPerMinute: 30,
    maxRequestsPerHour: 200,
    maxDataPerRequest: 50 * 1024 * 1024,
    timeoutMs: 10000
  };
  
  private readonly APPROVED_PACKAGES = new Map<string, any>([
    ['axios', { module: require('axios'), safe: true }],
    ['lodash', { module: require('lodash'), safe: true }],
    ['moment', { module: require('moment'), safe: true }],
    ['uuid', { module: require('uuid'), safe: true }],
    ['crypto', { module: require('crypto'), safe: true }],
  ]);

  constructor(client: Client, options?: { disableEventListeners?: boolean }) {
    this.client = client;
    this.installedPlugins = new Map();
    this.loadedPlugins = new Map();
    this.cooldowns = new Map();
    
    // Only setup event listeners if not disabled
    if (!options?.disableEventListeners) {
      this.setupEventListeners();
    }
    
    this.loadAllInstalledPlugins();
  }

  private async loadAllInstalledPlugins() {
    try {
      console.log('[PluginManager] Loading installed plugins from database...');
      
      const installedPlugins = await prisma.installedPlugin.findMany({
        where: { enabled: true }
      });

      console.log(`[PluginManager] Found ${installedPlugins.length} enabled plugins in database`);

      for (const installed of installedPlugins) {
        const { guildId, itemId } = installed;

        const marketplaceItem = await prisma.marketplaceItem.findUnique({
          where: { itemId }
        });

        if (!marketplaceItem) {
          console.error(`[PluginManager] Marketplace item not found for ${itemId}`);
          continue;
        }

        try {
          const dslCode = await this.downloadPluginCode(marketplaceItem.fileUrl);
          const manifest = this.parseManifest(dslCode);
          const imports = ImportValidator.extractImports(dslCode);
          
          // Validate imports against scopes
          const validation = ImportValidator.validate(dslCode, imports, manifest.scopes);
          if (!validation.valid) {
            console.error(`[PluginManager] ❌ Plugin ${itemId} has scope errors:`, validation.errors);
            console.warn(`[PluginManager] ⚠️ Warnings:`, validation.warnings);
            continue; // Skip loading this plugin
          }
          
          if (validation.warnings.length > 0) {
            console.warn(`[PluginManager] ⚠️ Plugin ${itemId} warnings:`, validation.warnings);
          }
          
          let settings = this.parseSettings(dslCode);

          if (installed.settings && typeof installed.settings === 'string') {
            try {
              const savedSettings = JSON.parse(installed.settings);
              for (const [key, value] of Object.entries(savedSettings)) {
                if (settings[key]) {
                  settings[key].value = value;
                }
              }
            } catch (err) {
              console.warn(`[PluginManager] Failed to parse saved settings for ${itemId}:`, err);
            }
          } else if (installed.settings && typeof installed.settings === 'object') {
            for (const [key, value] of Object.entries(installed.settings as any)) {
              if (settings[key]) {
                settings[key].value = value;
              }
            }
          }

          const installedPlugin: InstalledPlugin = {
            itemId, guildId, manifest, dslCode, settings, imports,
            installedAt: installed.installedAt, enabled: installed.enabled
          };

          if (!this.installedPlugins.has(guildId)) {
            this.installedPlugins.set(guildId, []);
          }
          this.installedPlugins.get(guildId)!.push(installedPlugin);

          await this.loadInstalledPlugin(guildId, installedPlugin);
          console.log(`[PluginManager] ✅ Loaded plugin "${manifest.name}" for guild ${guildId}`);
          
          // Log what logic handlers were found
          const loadedPlugin = this.loadedPlugins.get(guildId)?.get(itemId);
          if (loadedPlugin && loadedPlugin.logicHandlers.length > 0) {
            console.log(`[PluginManager] Plugin "${manifest.name}" has ${loadedPlugin.logicHandlers.length} logic handlers:`);
            loadedPlugin.logicHandlers.forEach((handler, idx) => {
              const patternPreview = handler.pattern.length > 60 ? handler.pattern.substring(0, 60) + '...' : handler.pattern;
              console.log(`  [${idx}] Type: ${handler.type}, Pattern: "${patternPreview}"`);
            });
          }
        } catch (error) {
          console.error(`[PluginManager] Failed to load plugin ${itemId} for guild ${guildId}:`, error);
        }
      }

      console.log('[PluginManager] ✅ All plugins loaded from database');
    } catch (error) {
      console.error('[PluginManager] Failed to load plugins from database:', error);
    }
  }

  async installPluginFromMarketplace(guildId: string, itemId: string) {
    try {
      const marketplaceItem = await prisma.marketplaceItem.findUnique({ where: { itemId } });
      if (!marketplaceItem) return { success: false, message: 'Plugin not found' };
      if (marketplaceItem.status !== 'approved') return { success: false, message: 'Not approved' };

      const dslCode = await this.downloadPluginCode(marketplaceItem.fileUrl);
      const manifest = this.parseManifest(dslCode);
      const imports = ImportValidator.extractImports(dslCode);
      
      // Validate imports before installation
      const validation = ImportValidator.validate(dslCode, imports, manifest.scopes);
      if (!validation.valid) {
        return { 
          success: false, 
          message: `Scope validation failed: ${validation.errors.join('; ')}` 
        };
      }
      
      const settings = this.parseSettings(dslCode);

      const existingPlugins = this.installedPlugins.get(guildId) || [];
      if (existingPlugins.find(p => p.itemId === itemId)) {
        return { success: false, message: 'Already installed' };
      }

      const installedPlugin: InstalledPlugin = {
        itemId, guildId, manifest, dslCode, settings, imports, installedAt: new Date(), enabled: true
      };

      if (!this.installedPlugins.has(guildId)) this.installedPlugins.set(guildId, []);
      this.installedPlugins.get(guildId)!.push(installedPlugin);
      await this.loadInstalledPlugin(guildId, installedPlugin);

      return { success: true, message: `Installed ${manifest.name}`, pluginName: manifest.name };
    } catch (error) {
      return { success: false, message: `Failed: ${error}` };
    }
  }

  private async downloadPluginCode(fileUrl: string): Promise<string> {
    const response = await axios.get(fileUrl, { responseType: 'text' });
    return response.data;
  }

  private async loadInstalledPlugin(guildId: string, installed: InstalledPlugin) {
    const plugin: LoadedPlugin = {
      itemId: installed.itemId, manifest: installed.manifest, dslCode: installed.dslCode,
      settings: installed.settings, imports: installed.imports, commands: new Map(), 
      buttonHandlers: new Map(), eventHandlers: {}, customFunctions: new Map(), 
      logicHandlers: [], vm: this.createPluginVM(guildId, installed.itemId, installed.dslCode)
    };

    this.parseCommands(plugin);
    this.parseButtonHandlers(plugin);
    this.parseLogicHandlers(plugin);
    this.parseCustomEvents(plugin);

    if (!this.loadedPlugins.has(guildId)) this.loadedPlugins.set(guildId, new Map());
    this.loadedPlugins.get(guildId)!.set(installed.itemId, plugin);
  }

  private parseManifest(code: string): PluginManifest {
    const manifestMatch = code.match(/manifest\s*{([\s\S]*?)^    }/m);
    if (!manifestMatch) throw new Error("No manifest");
    const text = manifestMatch[1];
    
    return {
      name: this.extractString(text, 'name') || '', 
      version: this.extractString(text, 'version') || '1.0.0',
      author: this.extractString(text, 'author') || '', 
      description: this.extractString(text, 'description') || '',
      homepage: this.extractString(text, 'homepage') || '', 
      iconUrl: this.extractString(text, 'iconUrl') || '',
      license: this.extractString(text, 'license') || '', 
      faq: this.extractString(text, 'faq') || '',
      price: this.extractNumber(text, 'price') || 0,
      tags: this.parseArray(text, 'tags'), 
      scopes: this.parseArray(text, 'scopes')
    };
  }

  private parseSettings(code: string): PluginSettings {
    const match = code.match(/settings\s*{([\s\S]*?)^    }/m);
    if (!match) return {};
    const settings: PluginSettings = {};
    const regex = /(int|string|bool)\s+"([^"]+)"\s*{([\s\S]*?)}/g;
    let m;
    while ((m = regex.exec(match[1])) !== null) {
      const type = m[1] as any;
      const key = m[2];
      const block = m[3];
      settings[key] = {
        type, 
        description: this.extractString(block, 'description') || '',
        default: this.parseDefaultValue(type, this.extractString(block, 'default') || '')
      };
    }
    return settings;
  }

  private parseDefaultValue(type: string, value: string): any {
    if (type === 'int') return parseInt(value) || 0;
    if (type === 'bool') return value === 'true';
    return value.replace(/^["']|["']$/g, '');
  }

  private parseCommands(plugin: LoadedPlugin) {
    const regex = /command\s+([\w.]+)\s*{/g;
    let m;
    
    while ((m = regex.exec(plugin.dslCode)) !== null) {
      const commandName = m[1];
      const startBrace = m.index + m[0].length - 1;
      const { content: commandBlock } = extractBlockContent(plugin.dslCode, startBrace);
      
      console.log(`[parseCommands] Found command: "${commandName}"`);

      const onCommandMatch = /on_command\s*{/.exec(commandBlock);
      let onCommandCode = '';
      
      if (onCommandMatch) {
        const onCommandStart = onCommandMatch.index + onCommandMatch[0].length - 1;
        const { content } = extractBlockContent(commandBlock, onCommandStart);
        onCommandCode = content.trim();
        console.log(`[parseCommands] Extracted on_command: ${onCommandCode.length} chars`);
      }

      const handler: CommandHandler = {
        description: this.extractString(commandBlock, 'description') || '',
        usage: this.extractString(commandBlock, 'usage') || '',
        parameters: this.parseParameters(commandBlock),
        onCommand: onCommandCode,
      };
      
      const cooldown = commandBlock.match(/cooldown\s+(\d+)s/);
      if (cooldown) handler.cooldown = parseInt(cooldown[1]);
      
      plugin.commands.set(commandName, handler);
    }
    
    // Parse on_reaction handlers
    this.parseReactionHandlers(plugin);
  }

  private parseReactionHandlers(plugin: LoadedPlugin) {
    const regex = /on_reaction\s*{/g;
    let match;
    
    if (!plugin.eventHandlers.onReaction) {
      plugin.eventHandlers.onReaction = [];
    }
    
    while ((match = regex.exec(plugin.dslCode)) !== null) {
      const startBrace = match.index + match[0].length - 1;
      const { content: reactionBlock } = extractBlockContent(plugin.dslCode, startBrace);
      
      console.log(`[parseReactionHandlers] Found on_reaction block`);
      
      // Extract cooldown if present
      const cooldownMatch = reactionBlock.match(/cooldown\s+(\d+)s/);
      const cooldown = cooldownMatch ? parseInt(cooldownMatch[1]) : undefined;
      
      // Extract on_cooldown handler
      const onCooldownMatch = /on_cooldown\s*{/.exec(reactionBlock);
      let onCooldownCode = '';
      if (onCooldownMatch) {
        const cooldownStart = onCooldownMatch.index + onCooldownMatch[0].length - 1;
        const { content } = extractBlockContent(reactionBlock, cooldownStart);
        onCooldownCode = content.trim();
      }
      
      // Extract execute handler
      const executeMatch = /execute\s*{/.exec(reactionBlock);
      let executeCode = '';
      if (executeMatch) {
        const executeStart = executeMatch.index + executeMatch[0].length - 1;
        const { content } = extractBlockContent(reactionBlock, executeStart);
        executeCode = content.trim();
      }
      
      plugin.eventHandlers.onReaction.push({
        cooldown,
        onCooldown: onCooldownCode,
        execute: executeCode
      } as any);
      
      console.log(`[parseReactionHandlers] Registered reaction handler with cooldown: ${cooldown}s`);
    }
  }

  private parseButtonHandlers(plugin: LoadedPlugin) {
    const regex = /on_click\s+([\w_]+)\s*{/g;
    let m;
    
    while ((m = regex.exec(plugin.dslCode)) !== null) {
      const buttonId = m[1];
      const startBrace = m.index + m[0].length - 1;
      const { content: buttonBlock } = extractBlockContent(plugin.dslCode, startBrace);
      
      console.log(`[parseButtons] Found button handler: "${buttonId}"`);

      const executeMatch = /execute\s*{/.exec(buttonBlock);
      let executeCode = '';
      
      if (executeMatch) {
        const executeStart = executeMatch.index + executeMatch[0].length - 1;
        const { content } = extractBlockContent(buttonBlock, executeStart);
        executeCode = content.trim();
        console.log(`[parseButtons] Extracted execute: ${executeCode.length} chars`);
      }

      const handler: ButtonHandler = {
        execute: executeCode,
      };
      
      const cooldown = buttonBlock.match(/cooldown\s+(\d+)s/);
      if (cooldown) handler.cooldown = parseInt(cooldown[1]);
      
      plugin.buttonHandlers.set(buttonId, handler);
    }
  }

  private parseLogicHandlers(plugin: LoadedPlugin) {
    // Find logic block
    const logicMatch = plugin.dslCode.match(/logic\s*{/);
    if (!logicMatch) {
      console.log('[parseLogicHandlers] No logic block found');
      return;
    }
    
    const startBrace = logicMatch.index! + logicMatch[0].length - 1;
    const { content: logicBlock } = extractBlockContent(plugin.dslCode, startBrace);
    
    console.log(`[parseLogicHandlers] Found logic block: ${logicBlock.length} chars`);
    console.log(`[parseLogicHandlers] Logic block preview:`, logicBlock.substring(0, 500));
    
    // Parse functions defined in logic block
    const functionRegex = /fun\s+([\w_]+)\s*\([^)]*\)(?:\s*->\s*\w+)?\s*{/g;
    let funcMatch;
    
    while ((funcMatch = functionRegex.exec(logicBlock)) !== null) {
      const funcName = funcMatch[1];
      const funcStart = funcMatch.index + funcMatch[0].length - 1;
      const { content: funcBody } = extractBlockContent(logicBlock, funcStart);
      
      console.log(`[parseLogicHandlers] Found logic function: ${funcName}`);
      plugin.customFunctions.set(funcName, funcBody);
    }
    
    // Parse on_listen handlers
    const onListenMatch = /on_listen\s*{/.exec(logicBlock);
    if (onListenMatch) {
      const listenStart = onListenMatch.index + onListenMatch[0].length - 1;
      const { content: listenBlock } = extractBlockContent(logicBlock, listenStart);
      
      console.log(`[parseLogicHandlers] Found on_listen block: ${listenBlock.length} chars`);
      console.log(`[parseLogicHandlers] on_listen preview:`, listenBlock.substring(0, 300));
      
      // Extract patterns like: if message.content... -> { ... }
      const patternRegex = /if\s+([^{]+)\s*->\s*{/g;
      let match;
      
      while ((match = patternRegex.exec(listenBlock)) !== null) {
        const pattern = match[1].trim();
        const actionStart = match.index + match[0].length - 1;
        const { content: action } = extractBlockContent(listenBlock, actionStart);
        
        plugin.logicHandlers.push({
          type: 'on_listen',
          pattern,
          action: action.trim()
        });
        
        console.log(`[parseLogicHandlers] ✅ Added listener pattern: "${pattern}"`);
        console.log(`[parseLogicHandlers] ✅ Action preview: ${action.substring(0, 100)}...`);
      }
      
      console.log(`[parseLogicHandlers] Total on_listen handlers: ${plugin.logicHandlers.filter(h => h.type === 'on_listen').length}`);
    } else {
      console.log('[parseLogicHandlers] ⚠️ No on_listen block found');
    }
    
    // Parse on_trigger handlers (for custom event triggers)
    const onTriggerRegex = /on_trigger\s+([\w_]+)\s*{/g;
    let triggerMatch;
    
    while ((triggerMatch = onTriggerRegex.exec(logicBlock)) !== null) {
      const eventName = triggerMatch[1];
      const triggerStart = triggerMatch.index + triggerMatch[0].length - 1;
      const { content: action } = extractBlockContent(logicBlock, triggerStart);
      
      plugin.logicHandlers.push({
        type: 'on_trigger',
        pattern: eventName,
        action: action.trim()
      });
      
      console.log(`[parseLogicHandlers] ✅ Added trigger handler: ${eventName}`);
    }
  }

  private parseCustomEvents(plugin: LoadedPlugin) {
    // Parse custom event definitions: event trigger_special_event { ... }
    const eventRegex = /event\s+([\w_]+)\s*{/g;
    let match;
    
    if (!plugin.eventHandlers.customEvents) {
      plugin.eventHandlers.customEvents = new Map();
    }
    
    while ((match = eventRegex.exec(plugin.dslCode)) !== null) {
      const eventName = match[1];
      const startBrace = match.index + match[0].length - 1;
      const { content: eventCode } = extractBlockContent(plugin.dslCode, startBrace);
      
      if (!plugin.eventHandlers.customEvents.has(eventName)) {
        plugin.eventHandlers.customEvents.set(eventName, []);
      }
      
      plugin.eventHandlers.customEvents.get(eventName)!.push(eventCode.trim());
      console.log(`[parseCustomEvents] Registered custom event: ${eventName}`);
    }
  }

  private parseParameters(block: string): Map<string, ParameterDef> {
    console.log('[parseParameters] Searching in block (first 1000 chars):\n', block.substring(0, 1000));
    
    const match = block.match(/parameters\s*{([\s\S]*?)}\s*(?=on_permission_denied|on_cooldown|on_command|$)/);
    if (!match) {
      console.log('[parseParameters] ❌ No parameters block found!');
      return new Map();
    }
    console.log('[parseParameters] ✅ Found parameters block:', match[1].substring(0, 300));
    const params = new Map<string, ParameterDef>();
    
    const parameterRegex = /(string|int|bool)\s+"([^"]+)"\s*{/g;
    let m;
    
    while ((m = parameterRegex.exec(match[1])) !== null) {
      const paramType = m[1];
      const paramName = m[2];
      const startPos = m.index + m[0].length;
      
      let depth = 1;
      let endPos = startPos;
      for (; endPos < match[1].length && depth > 0; endPos++) {
        if (match[1][endPos] === '{') depth++;
        if (match[1][endPos] === '}') depth--;
      }
      
      const paramContent = match[1].substring(startPos, endPos - 1);
      console.log('[parseParameters] Parsed parameter:', paramName, 'type:', paramType, 'content:', paramContent.substring(0, 100));
      
      params.set(paramName, {
        type: paramType as any, 
        description: this.extractString(paramContent, 'description') || '',
        required: paramContent.includes('required true')
      });
    }
    
    console.log('[parseParameters] Final params count:', params.size);
    return params;
  }

  private createPluginVM(guildId: string, itemId: string, dslCode: string): VM {
    const self = this;
    
    // Parse constants from DSL code
    const constants: { [key: string]: any } = {};
    const constRegex = /const\s+(\w+)\s*=\s*(.+)/g;
    let match;
    
    while ((match = constRegex.exec(dslCode)) !== null) {
      const constName = match[1];
      const constValue = match[2].trim().replace(/["']/g, '');
      
      // Try to parse as number if possible
      const numValue = Number(constValue);
      constants[constName] = isNaN(numValue) ? constValue : numValue;
      
      console.log(`[createPluginVM] Found constant: ${constName} = ${constants[constName]}`);
    }
    
    const embeds = {
      create: function() {
        const e: any = { color: 0x000000 };
        return {
          set_title: (t: string) => { e.title = t; return this; },
          set_description: (d: string) => { e.description = d; return this; },
          set_color: (c: number) => { e.color = c; return this; },
          build: () => ({ embeds: [e] }),
        };
      }
    };

    const buttons = {
      create_button: (label: string, id: string, style: string) => {
        const styleMap: { [key: string]: any } = {
          'primary': ButtonStyle.Primary,
          'secondary': ButtonStyle.Secondary,
          'success': ButtonStyle.Success,
          'danger': ButtonStyle.Danger
        };
        return new ButtonBuilder()
          .setLabel(label)
          .setCustomId(id)
          .setStyle(styleMap[style] || ButtonStyle.Primary);
      },
      create: (components: any[]) => {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(components);
      }
    };

    return new VM({
      timeout: 5000,
      sandbox: {
        // ===== CONSTANTS =====
        ...constants,  // Spread all parsed constants into the sandbox
        
        // ===== SETTINGS =====
        settings: {
          get: (key: string) => {
            const p = self.installedPlugins.get(guildId)?.find(p => p.itemId === itemId);
            return p?.settings[key]?.value ?? p?.settings[key]?.default;
          }
        },

        // ===== GUILDS =====
        guilds: {
          send: async (channelId: string, content: any) => {
            try {
              const ch = await self.client.channels.fetch(channelId).catch(() => null);
              if (!ch) {
                console.warn(`[guilds.send] ⚠️ Channel ${channelId} not found`);
                return;
              }
              if (ch.isTextBased()) await (ch as TextChannel).send(content);
              console.log(`[guilds.send] ✅ Sent message to channel ${channelId}`);
            } catch (err) {
              console.error('[guilds.send] ❌ Error:', err);
            }
          },
          
          create_channel: async (name: string, options: any = {}) => {
            try {
              const guild = await self.client.guilds.fetch(guildId);
              if (!guild) throw new Error('Guild not found');
              
              const channel = await guild.channels.create({
                name,
                type: options.type === 'voice' ? 2 : 0,
                topic: options.topic,
                parent: options.parent_id
              });
              
              console.log(`[guilds.create_channel] ✅ Created channel: ${channel.name} (${channel.id})`);
              return { 
                id: channel.id,
                name: channel.name,
                send: async (content: any, components?: any) => {
                  if (components) {
                    await channel.send({ content, components: [components] });
                  } else {
                    await channel.send(content);
                  }
                }
              };
            } catch (error: any) {
              console.error('[guilds.create_channel] ❌ Error:', error.message);
              throw error;
            }
          },

          fetch: async (guildIdParam?: string) => {
            try {
              const guild = await self.client.guilds.fetch(guildIdParam || guildId);
              return {
                id: guild.id,
                name: guild.name,
                create_channel: async (name: string, options: any = {}) => {
                  const ch = await guild.channels.create({
                    name,
                    type: options.type === 'voice' ? 2 : 0,
                    parent: options.parent_id
                  });
                  return { 
                    id: ch.id, 
                    name: ch.name, 
                    send: async (content: any, components?: any) => {
                      if (components) {
                        await ch.send({ content, components: [components] });
                      } else {
                        await ch.send(content);
                      }
                    }
                  };
                }
              };
            } catch (err) {
              console.error('[guilds.fetch] ❌ Error:', err);
              throw err;
            }
          },

          fetch_channel: async (channelId: string) => {
            try {
              const ch = await self.client.channels.fetch(channelId);
              return {
                id: ch?.id,
                name: (ch as any)?.name,
                send: async (content: any) => ch?.isTextBased() && await (ch as TextChannel).send(content),
                delete: async () => ch && await ch.delete()
              };
            } catch (err) {
              console.error('[guilds.fetch_channel] ❌ Error:', err);
              throw err;
            }
          }
        },

        // ===== USERS =====
        users: { 
          get: async (userId: string) => {
            try {
              const user = await self.client.users.fetch(userId);
              return {
                id: user.id,
                username: user.username,
                discriminator: '0'
              };
            } catch (err) {
              console.error('[users.get] ❌ Error:', err);
              throw err;
            }
          }
        },

        // ===== EMBEDS =====
        embeds,

        // ===== BUTTONS =====
        buttons,

        // ===== COOLDOWN =====
        cooldown: {
          is_on: (key: string, userId: string) => {
            const k = `${guildId}:${itemId}:${key}:${userId}`;
            const expiry = self.cooldowns.get(k) || 0;
            return Date.now() < expiry;
          },
          remaining: (userId: string, key: string) => {
            const k = `${guildId}:${itemId}:${key}:${userId}`;
            const expiry = self.cooldowns.get(k) || 0;
            return Math.max(0, expiry - Date.now());
          },
          set: (key: string, userId: string, seconds: number) => {
            const k = `${guildId}:${itemId}:${key}:${userId}`;
            self.cooldowns.set(k, Date.now() + (seconds * 1000));
          }
        },

        // ===== DATABASE =====
        db: {
          insert: async (table: string, data: any) => {
            try {
              console.log(`[db.insert] Inserting into ${table}:`, data);
              return Math.random().toString(36).substring(7);
            } catch (err) {
              console.error('[db.insert] ❌ Error:', err);
              throw err;
            }
          },
          update: async (table: string, data: any, where: any) => {
            try {
              console.log(`[db.update] Updating ${table}`);
              return true;
            } catch (err) {
              console.error('[db.update] ❌ Error:', err);
              throw err;
            }
          },
          delete: async (table: string, where: any) => {
            try {
              console.log(`[db.delete] Deleting from ${table}`);
              return true;
            } catch (err) {
              console.error('[db.delete] ❌ Error:', err);
              throw err;
            }
          },
          query: async (table: string, where: any) => [],
          query_one: async (table: string, where: any) => null,
          use: async (dbName: string) => console.log(`[db.use] Using database: ${dbName}`),
          set: async (table: string, schema: any) => console.log(`[db.set] Setting schema for ${table}`),
          send: async (channelId: string, content: any) => console.log(`[db.send] Message sent`)
        },

        // ===== TIME =====
        time: {
          now: async () => new Date().toISOString()
        },

        // ===== MATH =====
        math: {
          random_int: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
        },

        // ===== EMIT (for triggering events, functions, commands) =====
        emit: {
          trigger: async (target: string, data?: any) => {
            // Parse trigger format: event:name, fun:name, command:name
            const match = target.match(/^(event|fun|command):(.+)$/);
            if (!match) {
              console.error(`[emit.trigger] Invalid trigger format: ${target}`);
              throw new Error(`Invalid trigger format. Use: event:name, fun:name, or command:name`);
            }
            
            const [, type, name] = match;
            console.log(`[emit.trigger] Triggering ${type}: ${name}`);
            
            switch (type) {
              case 'event':
                await self.handleCustomEventTrigger(guildId, itemId, name, data);
                break;
              case 'fun':
                await self.handleFunctionTrigger(guildId, itemId, name, data);
                break;
              case 'command':
                await self.handleCommandTrigger(guildId, itemId, name, data);
                break;
            }
          }
        },

        // ===== MESSAGE UTILITIES =====
        msg: {
          react: async (channelId: string, messageId: string, emoji: string) => {
            try {
              const channel = await self.client.channels.fetch(channelId).catch(() => null);
              if (!channel || !channel.isTextBased()) {
                console.error('[msg.react] Channel not found or not text-based');
                return;
              }
              
              const message = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
              if (!message) {
                console.error('[msg.react] Message not found');
                return;
              }
              
              await message.react(emoji);
              console.log(`[msg.react] ✅ Reacted with ${emoji} to message ${messageId}`);
            } catch (err) {
              console.error('[msg.react] ❌ Error:', err);
              throw err;
            }
          }
        },

        // ===== PERMISSIONS =====
        permissions: {
          SEND_MESSAGES: 'SEND_MESSAGES',
          VIEW_CHANNEL: 'VIEW_CHANNEL',
          MANAGE_CHANNELS: 'MANAGE_CHANNELS',
          MANAGE_MESSAGES: 'MANAGE_MESSAGES',
          ADMINISTRATOR: 'ADMINISTRATOR',
          CREATE_INSTANT_INVITE: 'CREATE_INSTANT_INVITE'
        },

        user_has_permission: async (userId: string, guildId: string, perm: string) => {
          try {
            const guild = await self.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) return false;
            
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return false;
            
            const { PermissionFlagsBits } = require('discord.js');
            const permissionResolvable = PermissionFlagsBits[perm as keyof typeof PermissionFlagsBits] ?? perm;
            return member.permissions.has(permissionResolvable);
          } catch (err) {
            console.error('[user_has_permission] Error:', err);
            return false;
          }
        },

        // ===== PLUGINS =====
        plugins: {
          permissions: {
            has_scope: (scope: string) => {
              const p = self.installedPlugins.get(guildId)?.find(p => p.itemId === itemId);
              return p?.manifest?.scopes?.includes(scope) || false;
            }
          }
        },

        // ===== HTTP CLIENT =====
        http: self.createSafeHttpClient(guildId, itemId),

        // ===== APPROVED PACKAGES =====
        axios: self.getApprovedPackage('axios'),
        lodash: self.getApprovedPackage('lodash'),
        moment: self.getApprovedPackage('moment'),
        uuid: self.getApprovedPackage('uuid'),
        crypto: self.getApprovedPackage('crypto'),

        // ===== HELPER FUNCTIONS =====
        error_embed: (title: string, description: string) => {
          const e = embeds.create();
          e.set_title(title);
          e.set_description(description);
          e.set_color(0xFF0000);
          return e.build();
        },

        success_embed: (title: string, description: string) => {
          const e = embeds.create();
          e.set_title(title);
          e.set_description(description);
          e.set_color(0x00FF00);
          return e.build();
        },

        format_user_tag: (username: string) => username,
        
        format_time_span: (ms: number) => {
          const s = Math.floor(ms / 1000);
          return `${s}s`;
        },

        btn: (label: string, id: string, style: string) => {
          return buttons.create_button(label, id, style);
        },
        
        // Safe integer parsing helper - returns string if not a valid int
        safe_parse_int: (str: string) => {
          try {
            const num = parseInt(str);
            // If it's NaN or the string contains non-numeric chars, return the string as-is
            if (isNaN(num) || !/^\d+$/.test(str)) {
              return str; // Return string ID for alphanumeric IDs
            }
            return num;
          } catch (err) {
            return str;
          }
        },

        // ===== STANDARD JS =====
        console, Math, JSON, Date, parseInt, parseFloat, Array, Object, String, 
        isNaN, isFinite, Number, Boolean
      }
    });
  }

  async handleCommand(message: Message) {
    console.log('[PluginManager.handleCommand] MESSAGE RECEIVED:', message.content);
    
    if (!message.guild) return;

    const guildPlugins = this.loadedPlugins.get(message.guild.id);
    if (!guildPlugins) {
      console.log('[PluginManager] No loaded plugins for this guild');
      return;
    }

    // ALWAYS check logic handlers for all messages (not just commands)
    await this.handleLogicListeners(message);
    
    // Only process as command if it starts with ?
    if (!message.content.startsWith('?')) return;

    const content = message.content.slice(1);
    const args = content.split(' ');
    
    console.log('[PluginManager] Raw content:', content);
    console.log('[PluginManager] Raw args:', args);
    
    let commandName = args.shift()?.toLowerCase();
    if (!commandName) return;
    
    console.log('[PluginManager] After shift - commandName:', commandName, 'args:', args);
    
    // Check for subcommands
    if (args.length > 0) {
      const potentialSubcommand = `${commandName}.${args[0].toLowerCase()}`;
      
      for (const [itemId, plugin] of guildPlugins) {
        if (plugin.commands.has(potentialSubcommand)) {
          commandName = potentialSubcommand;
          args.shift();
          break;
        }
      }
    }

    console.log(`[PluginManager] Looking for command: "${commandName}", remaining args:`, args);

    for (const [itemId, plugin] of guildPlugins) {
      const handler = plugin.commands.get(commandName);
      
      if (handler) {
        console.log('[PluginManager] ✅ FOUND HANDLER! Executing...');
        console.log('[PluginManager] Handler expects parameters:', Array.from(handler.parameters.keys()));
        console.log('[PluginManager] Available args to use:', args);
        
        const parameters: any = {};
        let argIndex = 0;
        
        for (const [key, def] of handler.parameters) {
          console.log(`[PluginManager] Processing parameter: ${key} (type: ${def.type}), argIndex: ${argIndex}, args.length: ${args.length}`);
          if (argIndex < args.length) {
            const argValue = args[argIndex];
            
            if (def.type === 'string') {
              parameters[key] = args.slice(argIndex).join(' ');
              argIndex = args.length;
            } else if (def.type === 'int') {
              const intValue = parseInt(argValue);
              if (isNaN(intValue)) {
                console.log(`[PluginManager] Warning: "${argValue}" is not a valid integer, using as string`);
                parameters[key] = argValue;
              } else {
                parameters[key] = intValue;
              }
              argIndex++;
            } else if (def.type === 'bool') {
              parameters[key] = argValue.toLowerCase() === 'true' || argValue === '1';
              argIndex++;
            } else {
              parameters[key] = argValue;
              argIndex++;
            }
          } else if (def.required) {
            console.warn(`[PluginManager] ❌ Missing required parameter: ${key}`);
            parameters[key] = undefined;
          }
        }
        
        console.log('[PluginManager] Extracted parameters:', parameters);
        
        const missingParams: string[] = [];
        for (const [key, def] of handler.parameters) {
          if (def.required && (parameters[key] === undefined || parameters[key] === null || parameters[key] === '')) {
            missingParams.push(key);
          }
        }
        
        if (missingParams.length > 0) {
          console.error(`[PluginManager] ❌ Missing required parameters: ${missingParams.join(', ')}`);
          const errorMsg = `❌ **Missing Required Parameters**\n\nThis command requires: ${missingParams.join(', ')}\n\n**Usage:** ${handler.usage}`;
          await message.reply(errorMsg).catch(() => {});
          return;
        }

        const context = {
          message: {
            channelId: message.channelId,
            guildId: message.guildId,
            author: { id: message.author.id, username: message.author.username },
            content: message.content,
            id: message.id
          },
          parameters,
          guild_id: message.guild.id,
          channel_id: message.channelId,
        };

        await this.executeCode(plugin, handler.onCommand, context);
        return;
      }
    }
    
    console.log('[PluginManager] Command not found');
  }

  async handleButton(interaction: ButtonInteraction) {
    if (!interaction.guild) return;
    const plugins = this.loadedPlugins.get(interaction.guild.id);
    if (!plugins) return;

    for (const [itemId, plugin] of plugins) {
      const handler = plugin.buttonHandlers.get(interaction.customId);
      if (handler) {
        await this.executeCode(plugin, handler.execute, { interaction });
        return;
      }
    }
  }

  private async handleLogicListeners(message: Message) {
    if (!message.guild) return;
    
    const plugins = this.loadedPlugins.get(message.guild.id);
    if (!plugins) return;

    // Get channel name once for all patterns
    const channelName = message.channel && 'name' in message.channel 
      ? (message.channel as TextChannel).name 
      : '';

    for (const [itemId, plugin] of plugins) {
      for (const handler of plugin.logicHandlers) {
        if (handler.type !== 'on_listen') continue;
        
        try {
          console.log('[handleLogicListeners] Checking pattern:', handler.pattern);
          console.log('[handleLogicListeners] Message content:', message.content);
          console.log('[handleLogicListeners] Channel name:', channelName);
          
          // Just do the DSL replacements without the full transpiler wrapper
          let patternCode = handler.pattern;
          
          // Apply DSL transformations
          patternCode = patternCode.replace(/\blet\b/g, 'const');
          patternCode = patternCode.replace(/\band\b/g, '&&');
          patternCode = patternCode.replace(/\bor\b/g, '||');
          patternCode = patternCode.replace(/\bnot\b/g, '!');
          patternCode = patternCode.replace(/\.to_lower\(\)/g, '.toLowerCase()');
          patternCode = patternCode.replace(/\.to_upper\(\)/g, '.toUpperCase()');
          patternCode = patternCode.replace(/\.contains\(/g, '.includes(');
          patternCode = patternCode.replace(/\.starts_with\(/g, '.startsWith(');
          patternCode = patternCode.replace(/\.ends_with\(/g, '.endsWith(');
          
          // Create evaluation code with message object
          const evalCode = `
            (function() {
              const message = {
                channelId: "${message.channelId}",
                guildId: "${message.guildId}",
                author: { id: "${message.author.id}", username: "${message.author.username}" },
                content: ${JSON.stringify(message.content)},
                id: "${message.id}",
                channel: { name: ${JSON.stringify(channelName)} }
              };
              return ${patternCode};
            })()
          `;
          
          console.log('[handleLogicListeners] Evaluating:', evalCode.trim());
          
          const result = await plugin.vm.run(evalCode);
          
          console.log('[handleLogicListeners] Pattern result:', result);
          
          if (result === true) {
            console.log(`[handleLogicListeners] ✅ Pattern matched: ${handler.pattern}`);
            
            // Now execute the action with full context INCLUDING channel name
            const context = {
              message: {
                channelId: message.channelId,
                guildId: message.guildId,
                author: { id: message.author.id, username: message.author.username },
                content: message.content,
                id: message.id,
                channel: { name: channelName }
              },
              guild_id: message.guild.id,
              channel_id: message.channelId,
            };
            
            await this.executeCode(plugin, handler.action, context);
          }
        } catch (err) {
          console.error('[handleLogicListeners] Error evaluating pattern:', handler.pattern, err);
        }
      }
    }
  }

  private async handleCustomEventTrigger(guildId: string, itemId: string, eventName: string, data?: any) {
    const plugins = this.loadedPlugins.get(guildId);
    if (!plugins) return;

    const plugin = plugins.get(itemId);
    if (!plugin) return;

    // Execute custom event handlers
    if (plugin.eventHandlers.customEvents?.has(eventName)) {
      const handlers = plugin.eventHandlers.customEvents.get(eventName)!;
      
      for (const handler of handlers) {
        const context = {
          guild_id: guildId,
          channel_id: data?.channel_id || '',
          event_data: data || {}
        };
        
        await this.executeCode(plugin, handler, context);
      }
    }

    // Execute logic trigger handlers
    for (const handler of plugin.logicHandlers) {
      if (handler.type === 'on_trigger' && handler.pattern === eventName) {
        const context = {
          guild_id: guildId,
          channel_id: data?.channel_id || '',
          event_data: data || {}
        };
        
        await this.executeCode(plugin, handler.action, context);
      }
    }
  }

  private async handleFunctionTrigger(guildId: string, itemId: string, functionName: string, data?: any) {
    const plugins = this.loadedPlugins.get(guildId);
    if (!plugins) {
      console.error(`[handleFunctionTrigger] No plugins loaded for guild ${guildId}`);
      return;
    }

    const plugin = plugins.get(itemId);
    if (!plugin) {
      console.error(`[handleFunctionTrigger] Plugin ${itemId} not found`);
      return;
    }

    // Look for function definition in DSL code
    const functionRegex = new RegExp(`fun\\s+${functionName}\\s*\\(([^)]*)\\)\\s*(?:->\\s*\\w+)?\\s*{`, 'g');
    const match = functionRegex.exec(plugin.dslCode);
    
    if (!match) {
      console.error(`[handleFunctionTrigger] Function ${functionName} not found in plugin`);
      throw new Error(`Function '${functionName}' not found`);
    }

    // Parse function parameters
    const paramString = match[1];
    const paramNames: string[] = [];
    if (paramString.trim()) {
      // Parse parameters like "ticket_id: int" or "name: string"
      const params = paramString.split(',').map(p => p.trim());
      for (const param of params) {
        const parts = param.split(':');
        if (parts.length > 0) {
          paramNames.push(parts[0].trim());
        }
      }
    }

    console.log(`[handleFunctionTrigger] Function ${functionName} expects parameters:`, paramNames);
    console.log(`[handleFunctionTrigger] Received data:`, data);

    const startBrace = match.index + match[0].length - 1;
    const { content: functionBody } = extractBlockContent(plugin.dslCode, startBrace);

    console.log(`[handleFunctionTrigger] Executing function: ${functionName}`);
    
    // Build parameters object from data
    const functionParams: any = {};
    for (const paramName of paramNames) {
      if (data && data[paramName] !== undefined) {
        functionParams[paramName] = data[paramName];
      }
    }
    
    console.log(`[handleFunctionTrigger] Mapped parameters:`, functionParams);
    
    // Prepend parameter declarations to the function body
    let codeToExecute = functionBody;
    for (const paramName of paramNames) {
      const value = functionParams[paramName];
      if (value !== undefined) {
        // Add parameter as a const declaration at the beginning
        codeToExecute = `const ${paramName} = ${JSON.stringify(value)}\n${codeToExecute}`;
      }
    }
    
    const context = {
      guild_id: guildId,
      channel_id: data?.channel_id || '',
      parameters: functionParams,
      ...data
    };

    await this.executeCode(plugin, codeToExecute, context);
  }

  private async handleCommandTrigger(guildId: string, itemId: string, commandName: string, data?: any) {
    const plugins = this.loadedPlugins.get(guildId);
    if (!plugins) {
      console.error(`[handleCommandTrigger] No plugins loaded for guild ${guildId}`);
      return;
    }

    const plugin = plugins.get(itemId);
    if (!plugin) {
      console.error(`[handleCommandTrigger] Plugin ${itemId} not found`);
      return;
    }

    const handler = plugin.commands.get(commandName);
    if (!handler) {
      console.error(`[handleCommandTrigger] Command ${commandName} not found`);
      throw new Error(`Command '${commandName}' not found`);
    }

    console.log(`[handleCommandTrigger] Executing command: ${commandName}`);

    // Fetch channel name if we have a channel_id
    let channelName = '';
    if (data?.channel_id) {
      try {
        const channel = await this.client.channels.fetch(data.channel_id);
        if (channel && 'name' in channel) {
          channelName = (channel as TextChannel).name;
        }
      } catch (err) {
        console.warn(`[handleCommandTrigger] Could not fetch channel name:`, err);
      }
    }

    const context = {
      guild_id: guildId,
      channel_id: data?.channel_id || '',
      parameters: data?.parameters || data || {},
      message: data?.message || {
        channelId: data?.channel_id || '',
        guildId: guildId,
        author: data?.author || { id: '', username: '' },
        content: '',
        id: '',
        channel: { name: channelName }
      }
    };

    await this.executeCode(plugin, handler.onCommand, context);
  }

  private async executeCode(plugin: LoadedPlugin, code: string, context: any) {
    // Generate execution ID for tracking
    const executionId = Math.random().toString(36).substring(7);
    
    console.log(`[executeCode:${executionId}] CALLED!`);
    console.log(`[executeCode:${executionId}] Code length:`, code?.length);
    
    if (!code || code.length === 0) {
      console.error(`[executeCode:${executionId}] ❌ No code to execute!`);
      return;
    }

    try {
      code = this.replaceFormattedStrings(code);
      code = DSLTranspiler.transpile(code, context);
      
      console.log(`[executeCode:${executionId}] Transpiled JS:`);
      console.log('===== START OF CODE =====');
      console.log(code);
      console.log('===== END OF CODE =====');

      let injectedCode = code;
      if (context.interaction) {
        injectedCode = `
const interaction = ${JSON.stringify(context.interaction, (key, value) => {
  if (typeof value === 'function') return undefined;
  if (typeof value === 'bigint') return value.toString();
  return value;
})};
${code}`;
      }

      const wrappedCode = `(async function() { ${injectedCode} })();`;
      
      console.log(`[executeCode:${executionId}] 🚀 Running code in VM...`);
      await plugin.vm.run(wrappedCode);
      console.log(`[executeCode:${executionId}] ✅ Execution complete!`);
    } catch (err: any) {
      console.error(`[executeCode:${executionId}] ❌ ERROR:`, err);
      
      const errorEmbed = this.createErrorEmbed(err);
      
      if (context.message?.channelId) {
        await this.sendErrorToChannel(context.message.channelId, errorEmbed);
      } else if (context.interaction?.respond) {
        context.interaction.respond(errorEmbed);
      }
    }
  }

  private createErrorEmbed(err: any): any {
    const errorMessage = err.message || String(err);
    const errorStack = err.stack || '';
    
    let title = 'Code Execution Error';
    let description = errorMessage;
    let color = 0xFF0000;
    
    if (errorMessage.includes('Unexpected identifier')) {
      title = '❌ Syntax Error';
      description = `Unexpected identifier in code. Check your syntax.\n\n**Error:** ${errorMessage}`;
      color = 0xFF6B6B;
    } else if (errorMessage.includes('is not defined')) {
      title = '❌ Reference Error';
      description = `A variable or function is not defined.\n\n**Error:** ${errorMessage}`;
      color = 0xFF6B6B;
    } else if (errorMessage.includes('is not a function')) {
      title = '❌ Type Error';
      description = `Attempted to call something that is not a function.\n\n**Error:** ${errorMessage}`;
      color = 0xFF6B6B;
    } else if (errorMessage.includes('Cannot read properties') || errorMessage.includes('Cannot read property')) {
      title = '❌ Property Access Error';
      description = `Attempted to access a property on null or undefined.\n\n**Error:** ${errorMessage}`;
      color = 0xFF6B6B;
    } else if (errorMessage.includes('Timeout')) {
      title = '⏱️ Timeout Error';
      description = 'Code execution took too long (>5 seconds). Infinite loops or blocking operations detected.';
      color = 0xFFA500;
    }
    
    let stackInfo = '';
    if (errorStack) {
      const lines = errorStack.split('\n').slice(0, 3);
      stackInfo = lines.join('\n').substring(0, 200);
    }
    
    return {
      embeds: [{
        title,
        description,
        color,
        fields: stackInfo ? [{
          name: 'Stack Trace',
          value: `\`\`\`${stackInfo}\`\`\``,
          inline: false
        }] : [],
        timestamp: new Date().toISOString(),
        footer: { text: 'Error occurred during code execution' }
      }]
    };
  }

  private async sendErrorToChannel(channelId: string, embed: any): Promise<void> {
    try {
      const ch = await this.client.channels.fetch(channelId).catch(() => null);
      if (!ch) {
        console.warn(`[executeCode] ⚠️ Channel ${channelId} not found`);
        return;
      }
      if (ch.isTextBased()) {
        await (ch as TextChannel).send(embed);
        console.log(`[executeCode] ✅ Error embed sent to channel ${channelId}`);
      }
    } catch (err) {
      console.error('[executeCode] ❌ Failed to send error embed:', err);
    }
  }

  private createSafeHttpClient(guildId: string, itemId: string) {
    const axios = require('axios');
    
    const makeRequest = async (method: string, url: string, data?: any, options?: any) => {
      const startTime = Date.now();
      let responseSize = 0;
      let status = 0;
      let success = false;
      let errorReason = '';

      try {
        if (!url.startsWith('http')) throw new Error('Invalid URL - must start with http/https');
        
        const urlObj = new URL(url);
        if (this.blockedDomains.has(urlObj.hostname)) {
          throw new Error(`Domain ${urlObj.hostname} is blocked due to abuse`);
        }
        
        this.checkHttpRateLimits(guildId, itemId);
        
        const config = {
          timeout: this.requestLimits.timeoutMs,
          maxRedirects: 5,
          maxContentLength: this.requestLimits.maxDataPerRequest,
          headers: { 'User-Agent': 'FrostSentinel-PluginBot/1.0' },
          ...options
        };
        
        let response;
        switch (method.toUpperCase()) {
          case 'GET':
            response = await axios.get(url, config);
            break;
          case 'POST':
            response = await axios.post(url, data, config);
            break;
          case 'PUT':
            response = await axios.put(url, data, config);
            break;
          case 'DELETE':
            response = await axios.delete(url, config);
            break;
          default:
            throw new Error(`Unsupported HTTP method: ${method}`);
        }
        
        status = response.status;
        responseSize = JSON.stringify(response.data).length;
        success = true;
        
        this.logHttpRequest({
          timestamp: new Date(),
          method: method.toUpperCase(),
          url,
          status,
          responseSize,
          duration: Date.now() - startTime,
          pluginId: itemId,
          guildId,
          success: true
        });
        
        return response.data;
      } catch (err: any) {
        status = err.response?.status || 0;
        responseSize = 0;
        errorReason = err.message;
        success = false;
        
        this.logHttpRequest({
          timestamp: new Date(),
          method: method.toUpperCase(),
          url,
          status,
          responseSize,
          duration: Date.now() - startTime,
          pluginId: itemId,
          guildId,
          success: false,
          errorReason
        });
        
        throw new Error(`HTTP ${method} failed: ${err.message}`);
      }
    };
    
    return {
      get: (url: string, options?: any) => makeRequest('GET', url, undefined, options),
      post: (url: string, data: any, options?: any) => makeRequest('POST', url, data, options),
      put: (url: string, data: any, options?: any) => makeRequest('PUT', url, data, options),
      delete: (url: string, options?: any) => makeRequest('DELETE', url, undefined, options)
    };
  }

  private checkHttpRateLimits(guildId: string, pluginId: string) {
    const key = `${guildId}:${pluginId}`;
    const logs = this.httpLogs.get(key) || [];
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    
    const recentLogs = logs.filter(log => log.timestamp.getTime() > oneHourAgo);
    
    const lastMinute = recentLogs.filter(log => log.timestamp.getTime() > oneMinuteAgo);
    if (lastMinute.length >= this.requestLimits.maxRequestsPerMinute) {
      throw new Error(`Rate limit exceeded: ${this.requestLimits.maxRequestsPerMinute} requests per minute`);
    }
    
    if (recentLogs.length >= this.requestLimits.maxRequestsPerHour) {
      throw new Error(`Rate limit exceeded: ${this.requestLimits.maxRequestsPerHour} requests per hour`);
    }
    
    const failedCount = recentLogs.filter(log => !log.success).length;
    if (failedCount > 10) {
      console.warn(`[HTTP Monitor] ⚠️ Plugin ${pluginId} in guild ${guildId} has ${failedCount} failed requests`);
    }
    
    this.httpLogs.set(key, recentLogs);
  }

  private logHttpRequest(log: HttpRequestLog) {
    const key = `${log.guildId}:${log.pluginId}`;
    const logs = this.httpLogs.get(key) || [];
    logs.push(log);
    this.httpLogs.set(key, logs);
    
    const status = log.success ? '✅' : '❌';
    console.log(`[HTTP Monitor] ${status} ${log.method} ${log.url} (${log.duration}ms, ${log.responseSize} bytes)`);
    
    if (!log.success && log.status && log.status >= 500) {
      console.warn(`[HTTP Monitor] ⚠️ Server error from ${log.url}: ${log.status}`);
    }
  }

  public getHttpLogs(guildId: string, pluginId?: string) {
    if (pluginId) {
      const key = `${guildId}:${pluginId}`;
      return this.httpLogs.get(key) || [];
    }
    
    const logs: HttpRequestLog[] = [];
    for (const [key, values] of this.httpLogs) {
      if (key.startsWith(guildId)) {
        logs.push(...values);
      }
    }
    return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  public blockDomain(domain: string) {
    this.blockedDomains.add(domain);
    console.log(`[HTTP Monitor] 🚫 Blocked domain: ${domain}`);
  }

  public unblockDomain(domain: string) {
    this.blockedDomains.delete(domain);
    console.log(`[HTTP Monitor] ✅ Unblocked domain: ${domain}`);
  }

  public getBlockedDomains() {
    return Array.from(this.blockedDomains);
  }

  public setRequestLimit(type: 'perMinute' | 'perHour' | 'maxSize' | 'timeout', value: number) {
    switch (type) {
      case 'perMinute':
        this.requestLimits.maxRequestsPerMinute = value;
        break;
      case 'perHour':
        this.requestLimits.maxRequestsPerHour = value;
        break;
      case 'maxSize':
        this.requestLimits.maxDataPerRequest = value;
        break;
      case 'timeout':
        this.requestLimits.timeoutMs = value;
        break;
    }
    console.log(`[HTTP Monitor] Updated ${type} limit to ${value}`);
  }

  private getApprovedPackage(packageName: string): any {
    const pkg = this.APPROVED_PACKAGES.get(packageName);
    if (!pkg) {
      throw new Error(`Package "${packageName}" is not approved. Approved packages: ${Array.from(this.APPROVED_PACKAGES.keys()).join(', ')}`);
    }
    return pkg.module;
  }

  public async executePluginCode(guildId: string, itemId: string, code: string, context: any) {
    const plugins = this.loadedPlugins.get(guildId);
    if (!plugins) {
      console.error(`[executePluginCode] No plugins loaded for guild ${guildId}`);
      return;
    }

    const plugin = plugins.get(itemId);
    if (!plugin) {
      console.error(`[executePluginCode] Plugin ${itemId} not found in guild ${guildId}`);
      return;
    }

    await this.executeCode(plugin, code, context);
  }

  private replaceFormattedStrings(code: string): string {
    return code.replace(/\$"([^"]*)"/g, (match, content) => {
      const converted = content.replace(/{([^}]+)}/g, '${$1}');
      return '`' + converted + '`';
    });
  }

  async uninstallPlugin(guildId: string, itemId: string) {
    const plugins = this.installedPlugins.get(guildId);
    const idx = plugins?.findIndex(p => p.itemId === itemId) ?? -1;
    if (idx === -1) return { success: false, message: 'Not found' };
    plugins!.splice(idx, 1);
    this.loadedPlugins.get(guildId)?.delete(itemId);
    return { success: true, message: 'Uninstalled' };
  }

  getInstalledPlugins(guildId: string) { return this.installedPlugins.get(guildId) || []; }

  async togglePlugin(guildId: string, itemId: string, enabled: boolean) {
    const plugin = this.installedPlugins.get(guildId)?.find(p => p.itemId === itemId);
    if (!plugin) return { success: false, message: 'Not found' };
    plugin.enabled = enabled;
    if (enabled) await this.loadInstalledPlugin(guildId, plugin);
    else this.loadedPlugins.get(guildId)?.delete(itemId);
    return { success: true, message: enabled ? 'Enabled' : 'Disabled' };
  }

  private extractString(text: string, field: string) {
    return text.match(new RegExp(`${field}\\s+"([^"]+)"`))?.[1] || null;
  }

  private extractNumber(text: string, field: string) {
    return parseInt(text.match(new RegExp(`${field}\\s+(\\d+)`))?.[1] || '0');
  }

  private parseArray(text: string, field: string) {
    const match = text.match(new RegExp(`${field}\\s*\\[([\\s\\S]*?)\\]`));
    return match ? match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean) : [];
  }

  private setupEventListeners() {
    this.client.on('messageCreate', async (msg) => { 
      if (msg.author.bot) return; // Filter bot messages
      await this.handleCommand(msg);
    });
    
    this.client.on('interactionCreate', i => { if (i.isButton()) this.handleButton(i); });
    
    // Handle reactions
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      
      const message = reaction.message;
      if (!message.guild) return;
      
      const plugins = this.loadedPlugins.get(message.guild.id);
      if (!plugins) return;
      
      for (const [itemId, plugin] of plugins) {
        if (!plugin.eventHandlers.onReaction || plugin.eventHandlers.onReaction.length === 0) continue;
        
        for (const handler of plugin.eventHandlers.onReaction as any[]) {
          // Check cooldown if defined
          if (handler.cooldown) {
            const cooldownKey = 'reaction_handler';
            const cdKey = `${message.guild.id}:${itemId}:${cooldownKey}:${user.id}`;
            const expiry = this.cooldowns.get(cdKey) || 0;
            
            if (Date.now() < expiry) {
              // On cooldown - execute on_cooldown handler if exists
              if (handler.onCooldown) {
                const context = {
                  guild_id: message.guild.id,
                  channel_id: message.channelId,
                  reaction: {
                    user_id: user.id,
                    emoji: reaction.emoji.name || reaction.emoji.id,
                    channel_id: message.channelId,
                    message_id: message.id
                  }
                };
                await this.executeCode(plugin, handler.onCooldown, context);
              }
              continue;
            }
            
            // Set cooldown
            this.cooldowns.set(cdKey, Date.now() + (handler.cooldown * 1000));
          }
          
          // Execute main handler
          if (handler.execute) {
            const context = {
              guild_id: message.guild.id,
              channel_id: message.channelId,
              reaction: {
                user_id: user.id,
                emoji: reaction.emoji.name || reaction.emoji.id,
                channel_id: message.channelId,
                message_id: message.id
              }
            };
            await this.executeCode(plugin, handler.execute, context);
          }
        }
      }
    });
  }
}