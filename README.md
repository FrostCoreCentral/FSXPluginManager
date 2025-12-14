# FrostSentinel Plugin System

> 🎨 **Created by FrostByteNinja** | A powerful, secure, and extensible Discord bot plugin system

## 📖 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Getting Started](#getting-started)
- [Creating Your First Plugin](#creating-your-first-plugin)
- [DSL Syntax Guide](#dsl-syntax-guide)
- [Examples](#examples)
- [Contributing](#contributing)
- [License & Attribution](#license--attribution)

---

## 🌟 Overview

The FrostSentinel Plugin System allows developers to create powerful Discord bot plugins using a custom Domain-Specific Language (DSL). This system provides:

- **Easy-to-learn syntax** - Write plugins without complex JavaScript
- **Built-in security** - Sandboxed execution with scope-based permissions
- **Rich features** - Commands, buttons, reactions, logic handlers, and more
- **Hot-reloading** - Install and uninstall plugins without restarting your bot

## ✨ Features

### Core Features
- 🎯 **Custom Commands** - Create slash-style commands with parameters
- 🔘 **Button Interactions** - Handle Discord button clicks
- 💬 **Message Listeners** - React to specific message patterns
- 🎭 **Reaction Handlers** - Respond to emoji reactions
- 🗄️ **Database Integration** - Built-in database operations
- ⏱️ **Cooldown System** - Prevent spam with customizable cooldowns
- 🔐 **Permission Checks** - User and bot permission validation

### Advanced Features
- 🎨 **Custom Events** - Define and trigger your own events
- 🔄 **Function Triggers** - Call reusable functions across your plugin
- 🧩 **Logic Handlers** - Complex message pattern matching and automation
- 📊 **HTTP Client** - Make external API calls (with rate limiting)
- 🎨 **Embed Builder** - Beautiful Discord embeds

## 🚀 Getting Started

### Prerequisites

```bash
npm install discord.js vm2 axios @prisma/client
```

### Installation

1. Clone the repository:
```bash
git clone https://github.com/FrostCoreCentral/FSXPluginManager
cd FSXPluginManager
```

2. Install dependencies:
```bash
npm install
```

3. Configure your bot:
```typescript
import { PluginManager } from './PluginManager';

const client = new Client({ intents: [...] });
const pluginManager = new PluginManager(client);
```

## 📝 Creating Your First Plugin

Let's create a simple "Hello World" plugin:

```javascript
module plugin {
    manifest {
        name "HelloWorld"
        version "1.0.0"
        author "YourName"
        description "My first plugin!"
        tags ["example", "tutorial"]
        price 0
        scopes ["messages.send"]
    }

    // Simple command that says hello
    command hello {
        description "Say hello to the user"
        usage "?hello"
        
        on_command {
            guilds.send(message.channel_id, "Hello, World!")
        }
    }
}
```

**What's happening here?**
- `manifest` - Defines your plugin's metadata
- `scopes` - Permissions your plugin needs (like "messages.send")
- `command` - Creates a command users can run with `?hello`
- `guilds.send()` - Sends a message to the channel

## 📚 DSL Syntax Guide

### Basic Syntax

The DSL uses familiar JavaScript-like syntax with some simplifications:

```javascript
// Variables (automatically const)
let username = "FrostByte"
let count = 42

// Conditionals
if username == "FrostByte" {
    // Do something
}

// String operations
if message.content.to_lower().contains("hello") {
    // Respond to "hello"
}

// Logical operators
if count > 10 and count < 100 {
    // count is between 10 and 100
}
```

### Available Scopes

When creating plugins, declare what permissions you need in `scopes`:

| Scope | What it allows |
|-------|---------------|
| `messages.send` | Send messages to channels |
| `channels.create` | Create new channels |
| `channels.delete` | Delete channels |
| `channels.read` | Read channel information |
| `db.read` | Read from database |
| `db.write` | Write to database |
| `buttons.use` | Create and handle buttons |
| `events.reaction` | Handle emoji reactions |
| `voice.connect` | Connect to voice channels |

### Commands

```javascript
command greet {
    description "Greet a user"
    usage "?greet <username>"
    cooldown 5s  // 5 second cooldown
    
    parameters {
        string "username" {
            description "User to greet"
            required true
        }
    }
    
    on_command {
        let name = parameters.username
        guilds.send(message.channel_id, $"Hello, {name}!")
    }
}
```

### Button Handlers

```javascript
on_click my_button {
    cooldown 10s
    
    execute {
        guilds.send(interaction.channel_id, "Button clicked!")
    }
    
    on_cooldown {
        guilds.send(interaction.channel_id, "Wait 10 seconds!")
    }
}
```

### Logic Listeners

Automatically respond to messages matching patterns:

```javascript
logic {
    on_listen {
        // React when someone says "help"
        if message.content.to_lower().contains("help") -> {
            guilds.send(message.channel_id, "Need assistance? Use ?help")
        }
        
        // Pattern matching
        if message.channel.name.starts_with("ticket-") -> {
            // This is a ticket channel, do something
        }
    }
}
```

### Custom Events

```javascript
// Define an event
event user_leveled_up {
    guilds.send(settings.get("log_channel"), "Someone leveled up!")
}

// Trigger it from anywhere
command level {
    on_command {
        // ... level up logic ...
        emit.trigger(event:user_leveled_up, {})
    }
}
```

### Database Operations

```javascript
// Create table schema
on_load {
    db.use("my_database")
    db.set("users", {
        "id": "int PRIMARY KEY AUTO_INCREMENT",
        "username": "text",
        "points": "int"
    })
}

// Insert data
let userId = db.insert("users", {
    "username": "FrostByte",
    "points": 100
})

// Query data
let user = db.query_one("users", { "id": userId })

// Update data
db.update("users", { "points": 150 }, { "id": userId })

// Delete data
db.delete("users", { "id": userId })
```

### Helper Functions

```javascript
// Create reusable functions
fun calculate_level(xp: int) -> int {
    return xp / 100
}

// Call them later
let level = calculate_level(500)  // Returns 5
```

## 💡 Examples

### Example 1: XP System

```javascript
module plugin {
    manifest {
        name "XPSystem"
        version "1.0.0"
        author "YourName"
        description "Reward users for chatting"
        scopes ["db.read", "db.write", "messages.send"]
    }

    on_load {
        db.use("bot_database")
        db.set("xp", {
            "user_id": "bigint PRIMARY KEY",
            "xp": "int",
            "level": "int"
        })
    }

    logic {
        on_listen {
            // Give XP for every message
            if message.content.length > 5 -> {
                let user = db.query_one("xp", { "user_id": message.author.id })
                
                if user == null {
                    db.insert("xp", {
                        "user_id": message.author.id,
                        "xp": 10,
                        "level": 1
                    })
                } else {
                    let newXp = user.xp + 10
                    let newLevel = newXp / 100
                    
                    db.update("xp", {
                        "xp": newXp,
                        "level": newLevel
                    }, {
                        "user_id": message.author.id
                    })
                    
                    if newLevel > user.level {
                        guilds.send(message.channel_id, 
                            $"🎉 {message.author.username} reached level {newLevel}!")
                    }
                }
            }
        }
    }

    command rank {
        description "Check your rank"
        usage "?rank"
        
        on_command {
            let user = db.query_one("xp", { "user_id": message.author.id })
            
            if user == null {
                guilds.send(message.channel_id, "You have no XP yet!")
            } else {
                guilds.send(message.channel_id, 
                    $"Level: {user.level} | XP: {user.xp}")
            }
        }
    }
}
```

### Example 2: Poll System

```javascript
module plugin {
    manifest {
        name "PollSystem"
        version "1.0.0"
        author "YourName"
        description "Create polls with reactions"
        scopes ["messages.send", "events.reaction"]
    }

    command poll {
        description "Create a poll"
        usage "?poll <question>"
        
        parameters {
            string "question" {
                description "The poll question"
                required true
            }
        }
        
        on_command {
            let question = parameters.question
            guilds.send(message.channel_id, $"📊 Poll: {question}")
            message.react("👍")
            message.react("👎")
        }
    }

    on_reaction {
        execute {
            let emoji = reaction.emoji
            guilds.send(reaction.channel_id, 
                $"Vote recorded: {emoji}")
        }
    }
}
```

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Plugin Contributions

1. **Create a plugin** using the DSL
2. **Test it thoroughly** in your Discord server
3. **Submit it** to the marketplace

### Code Contributions

⚠️ **Important:** All changes to the core PluginManager must be approved by **FrostByteNinja**.

To contribute code:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test extensively
5. Submit a pull request with detailed description

**Please include:**
- Clear description of changes
- Why the change is needed
- How it's been tested
- Any breaking changes

### Guidelines

- ✅ Follow existing code style
- ✅ Add comments for complex logic
- ✅ Include examples for new features
- ✅ Update documentation
- ❌ Don't modify core security features without discussion

## 📄 License & Attribution

### License
This project is licensed under the MIT License - see LICENSE file for details.

### Attribution

**FrostSentinel Plugin System** was created and is maintained by **FrostByteNinja**.

When using or modifying this system:
- ✅ Give credit to FrostByteNinja
- ✅ Link back to the original repository
- ✅ Maintain this attribution notice

**Example attribution:**
```
Powered by FrostSentinel Plugin System
Created by FrostByteNinja
https://github.com/YourUsername/FrostSentinel
```

### Core Maintainer Rights

- All modifications to `PluginManager.ts` require approval from FrostByteNinja
- Security-related changes require thorough review
- Breaking changes will be carefully considered

## 🆘 Support

- 📖 [Documentation](https://docs.frostsentinel.io)
- 💬 [Discord Server](https://discord.gg/your-invite)
- 🐛 [Report Issues](https://github.com/YourUsername/FrostSentinel/issues)
- 💡 [Feature Requests](https://github.com/YourUsername/FrostSentinel/discussions)

## 🙏 Acknowledgments

Special thanks to:
- The Discord.js community
- All plugin creators and contributors
- Early testers and supporters

---

**Made with ❤️ by FrostByteNinja**

*Empowering Discord bot developers worldwide*
