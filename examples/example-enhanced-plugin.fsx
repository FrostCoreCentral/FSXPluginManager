module plugin {
    manifest {
        name "EnhancedTicketMaster"
        version "2.0.0"
        author "FrostByteNinja"
        description "Advanced ticket system with typed triggers, reactions, and function calls"
        tags ["tickets", "support", "enhanced"]
        price 0
        scopes [
            "db.read",
            "db.write",
            "channels.create",
            "channels.delete",
            "channels.read",
            "messages.send",
            "buttons.use",
            "voice.connect",
            "events.reaction"
        ]
        homepage "https://frostsentinel.io"
        iconUrl "https://example.com/icon.png"
        license "MIT"
        faq "https://frostsentinel.io/faq"
    }

    // --- Modules used ---
    use interactions.create
    use db.set
    use db.use
    use db.send
    use plugins.settings
    use plugins.permissions
    use logic.custom
    use logic.time
    use utils.cooldown
    use discord.users
    use discord.guilds
    use discord.message
    use discord.embeds
    use discord.buttons
    use fastlink
    use discord.permissions
    use events.reaction

    // --- Constants ---
    const REACTION_COOLDOWN_KEY = "reaction_test"
    const SPECIAL_EVENT_TRIGGER = 2500

    // --- Helper functions ---
    fun error_embed(title: string, description: string) {
        let embed = embeds.create()
        embed.set_title(title)
        embed.set_description(description)
        embed.set_color(0xFF0000)
        return embed.build()
    }

    fun success_embed(title: string, description: string) {
        let embed = embeds.create()
        embed.set_title(title)
        embed.set_description(description)
        embed.set_color(0x00FF00)
        return embed.build()
    }

    fun btn(label: string, id: string, style: string) {
        return buttons.create_button(label, id, style)
    }

    fun format_time_span(span) -> string {
        return $"{span.Days}d {span.Hours}h {span.Minutes}m {span.Seconds}s"
    }

    fun format_user_tag(username: string, discriminator: string) -> string {
        if discriminator != null and discriminator != "0" {
            return $"{username}#{discriminator}"
        }
        return username
    }

    fun user_has_permission(user_id: bigint, guild_id: bigint, perm) -> bool {
        return discord.permissions.has(user_id, guild_id, perm)
    }

    // --- Custom reusable function that can be triggered ---
    fun close_ticket_logic(ticket_id: int) {
        let ticket = db.query_one("tickets", { "id": ticket_id })
        if ticket == null {
            guilds.send(settings.get("log_channel_id"), error_embed("Ticket Not Found", $"No ticket found with ID {ticket_id}."))
            return
        }

        db.delete("tickets", { "id": ticket_id })

        try {
            let channel = guilds.fetch_channel(ticket.channel_id)
            if channel != null {
                channel.send($"Ticket {ticket_id} has been closed.")
                channel.delete()
            }
        } catch err {
            let logChannel = settings.get("log_channel_id")
            if logChannel != 0 {
                let embed = embeds.create()
                embed.set_title("Ticket Close Error")
                embed.set_description($"Error closing ticket {ticket_id}: {err}")
                embed.set_color(0xFFAA00)
                guilds.send(logChannel, embed.build())
            }
        }
    }

    // --- Settings ---
    settings {
        int "ticket_category_id" {
            description "The category ID where tickets will be created."
            default 0
        }

        string "welcome_message" {
            description "The welcome message for new users."
            default "Welcome to the server!"
        }

        int "log_channel_id" {
            description "Channel used for plugin logs and errors."
            default 0
        }
    }

    // --- DB init ---
    on_load {
        db.use("bot_database")
        db.set("tickets", {
            "id": "int PRIMARY KEY AUTO_INCREMENT",
            "user_id": "bigint",
            "channel_id": "bigint",
            "reason": "text",
            "created_at": "datetime"
        })
    }

    // --- Welcome new member ---
    on_member_join {
        let welcomeMsg = settings.get("welcome_message")
        guilds.send(guild_id, $"{welcomeMsg} {member.user_tag}!")
    }

    // Custom Events
    event trigger_special_event {
        let logChannel = settings.get("log_channel_id")
        if logChannel != 0 {
            let embed = embeds.create()
            embed.set_title("🎉 Special Event Triggered!")
            embed.set_description("Congratulations! You triggered a rare event!")
            embed.set_color(0xFF00FF)
            guilds.send(logChannel, embed.build())
        }
    }

    event ticket_created {
        let logChannel = settings.get("log_channel_id")
        if logChannel != 0 {
            guilds.send(logChannel, success_embed("Ticket Created", "A new ticket has been created successfully!"))
        }
    }

    // --- Command: create ticket ---
    command ticket.create {
        cooldown 10s
        user_permissions [permissions.SEND_MESSAGES, permissions.VIEW_CHANNEL]
        bot_permissions [permissions.MANAGE_CHANNELS, permissions.CREATE_INSTANT_INVITE]
        description "Creates a support ticket."
        usage "?ticket create <reason>"

        parameters {
            string "reason" {
                description "The reason for creating the ticket."
                required true
            }
        }

        on_permission_denied bot_permissions {
            guilds.send(message.channel_id, error_embed("Bot Permission Denied", "The bot lacks the necessary permissions."))
        }

        on_permission_denied user_permissions {
            guilds.send(message.channel_id, error_embed("User Permission Denied", "You lack the necessary permissions."))
        }

        on_cooldown {
            let remaining = cooldown.remaining(message.author.id, "ticket.create")
            guilds.send(message.channel_id, error_embed("Command on Cooldown", $"You can use this command again in {format_time_span(remaining)}."))
        }

        on_command {
            let reason = parameters.reason
            let user = users.get(message.author.id)

            if settings.get("ticket_category_id") == 0 {
                guilds.send(message.channel_id, error_embed("Configuration Error", "No ticket_category_id configured."))
                return
            }

            try {
                let now = time.now()
                let ticketId = db.insert("tickets", {
                    "user_id": user.id,
                    "channel_id": 0,
                    "reason": reason,
                    "created_at": now
                })

                let g = guilds.fetch(message.guild_id)
                let channelObj = g.create_channel($"ticket-{ticketId}", {
                    "type": "text",
                    "parent_id": settings.get("ticket_category_id"),
                    "topic": $"Ticket for {user.username} - Reason: {reason}"
                })

                db.update("tickets", {
                    "channel_id": channelObj.id
                }, {
                    "id": ticketId
                })

                let userTag = format_user_tag(user.username, user.discriminator)
                let ticketInfo = $"Ticket ID: {ticketId}\nUser: {userTag}\nReason: {reason}\nCreated At: {now}"

                let row = buttons.create([btn("Close Ticket", "close_ticket", "danger")])

                channelObj.send(ticketInfo + "\nUse the button below to close the ticket.", row)
                guilds.send(message.channel_id, success_embed("Ticket Created", ticketInfo))

                // React to the message with a checkmark
                message.react("✅")

                // Trigger custom event
                emit.trigger(event:ticket_created, {})
            } catch err {
                let logChannel = settings.get("log_channel_id")
                if logChannel != 0 {
                    guilds.send(logChannel, error_embed("Ticket Creation Error", $"Error: {err}"))
                }
                guilds.send(message.channel_id, error_embed("Ticket Error", "Failed to create ticket."))
            }
        }
    }

    // --- Button click: close ticket ---
    on_click close_ticket {
        cooldown 5s

        on_cooldown {
            let remaining = cooldown.remaining(interaction.author.id, "close_ticket")
            interaction.respond(error_embed("Button on Cooldown", $"You can use this button again in {format_time_span(remaining)}."))
        }

        execute {
            if not plugins.permissions.has_scope("channels.delete") {
                interaction.respond(error_embed("Plugin Error", "Plugin lacks permission to delete channels."))
                return
            }

            let channel = guilds.fetch_channel(interaction.channel_id)
            let user = interaction.user
            let guildId = interaction.guild_id

            let isAdmin = user_has_permission(user.id, guildId, permissions.MANAGE_MESSAGES) || user_has_permission(user.id, guildId, permissions.ADMINISTRATOR)

            let ticketRow = db.query_one("tickets", { "channel_id": channel.id })
            let isOwner = ticketRow != null and ticketRow.user_id == user.id

            if not (isAdmin or isOwner) {
                interaction.respond(error_embed("Permission Denied", "You don't have permission to close this ticket."))
                return
            }

            // Call the reusable function via trigger
            if ticketRow != null {
                emit.trigger(fun:close_ticket_logic, { ticket_id: ticketRow.id })
            }
        }
    }

    // --- Command: close ticket by id (admin-only) ---
    command ticket.close {
        description "Closes a ticket by ID (admin only)."
        usage "?ticket close <ticket_id>"

        parameters {
            int "ticket_id" {
                description "The ID of the ticket to close."
                required true
            }
        }

        on_command {
            let ticketId = parameters.ticket_id

            let callerIsAdmin = user_has_permission(message.author.id, message.guild_id, permissions.MANAGE_MESSAGES) || 
                                user_has_permission(message.author.id, message.guild_id, permissions.ADMINISTRATOR)
            if not callerIsAdmin {
                guilds.send(message.channel_id, error_embed("Permission Denied", "You must have Manage Messages or Administrator."))
                return
            }

            // Trigger the close_ticket_logic function
            emit.trigger(fun:close_ticket_logic, { ticket_id: ticketId })
            guilds.send(message.channel_id, success_embed("Ticket Closed", $"Ticket {ticketId} closed successfully."))
        }
    }

    // --- Reaction handler ---
    on_reaction {
        cooldown 5s

        on_cooldown {
            let remaining = cooldown.remaining(reaction.user_id, REACTION_COOLDOWN_KEY)
            let embed = embeds.create()
            embed.set_title("Reaction on Cooldown")
            embed.set_description($"You can react again in {format_time_span(remaining)}.")
            embed.set_color(0xFF0000)
            guilds.send(reaction.channel_id, embed.build())
        }

        execute {
            let user = users.get(reaction.user_id)
            guilds.send(reaction.channel_id, $"{user.username} reacted with {reaction.emoji}!")

            try {
                let rand = math.random_int(1, 5000)
                if rand == SPECIAL_EVENT_TRIGGER {
                    emit.trigger(event:trigger_special_event, {})
                }
            } catch err {
                let logChannel = settings.get("log_channel_id")
                if logChannel != 0 {
                    guilds.send(logChannel, error_embed("Special Event Trigger Error", $"Failed to trigger: {err}"))
                }
            }
        }
    }

    // --- Logic section: message listeners ---
    logic {
        fun format_time_span_local(span) -> string {
            return format_time_span(span)
        }

        fun is_user_admin_local(user_id: bigint, guild_id: bigint) -> bool {
            return user_has_permission(user_id, guild_id, permissions.ADMINISTRATOR)
        }

        fun safe_parse_int(str: string) -> int {
            try {
                return str.as_int()
            } catch err {
                return 0
            }
        }

        on_listen {
            if message.content.to_lower().contains("close my ticket") -> {
                if message.channel.name.starts_with("ticket-") {
                    let parts = message.channel.name.split("-")
                    if parts.length >= 2 {
                        let idStr = parts[1]
                        let parsed = safe_parse_int(idStr)
                        if parsed > 0 {
                            // Trigger the command directly
                            emit.trigger(command:ticket.close, {
                                parameters: { ticket_id: parsed },
                                channel_id: message.channel_id
                            })
                        } else {
                            guilds.send(message.channel_id, error_embed("Cannot Parse Ticket", "Invalid ticket ID."))
                        }
                    }
                } else {
                    guilds.send(message.channel_id, "You are not in a ticket channel.")
                }
            }

            if message.content.to_lower().contains("time left") -> {
                if cooldown.is_on(message.author.id, REACTION_COOLDOWN_KEY) {
                    let remaining = cooldown.remaining(message.author.id, REACTION_COOLDOWN_KEY)
                    let formatted = format_time_span_local(remaining)
                    guilds.send(message.channel_id, $"You have {formatted} left on your reaction cooldown.")
                } else {
                    guilds.send(message.channel_id, "You are not on cooldown for reactions.")
                }
            }

            if message.content.to_lower().starts_with("trigger event") -> {
                // Manually trigger the special event
                emit.trigger(event:trigger_special_event, {})
                message.react("🎉")
            }

            if message.content.to_lower().starts_with("test function") -> {
                // Test calling a function directly
                emit.trigger(fun:success_embed, {
                    title: "Function Test",
                    description: "Successfully called function via trigger!"
                })
            }
        }

        // Trigger handler example - responds to custom events
        on_trigger special_event {
            let logChannel = settings.get("log_channel_id")
            if logChannel != 0 {
                guilds.send(logChannel, success_embed("Event Handler Triggered", "The special_event was caught by on_trigger!"))
            }
        }
    }
}
