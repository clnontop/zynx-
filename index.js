const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
    ChannelType,
    REST,
    Routes,
    ActivityType
} = require('discord.js');
require('dotenv').config();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('./keep_alive.js'); // Keeps the bot alive 24/7

// --- Configuration ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

// --- State Management ---
let ticketActivity = new Map();
let ticketProgress = new Map(); // Tracks button clicks: channelId -> Set(['rules', 'req', 'loadout'])
const TICKETS_FILE = path.join(__dirname, 'tickets.json');

// Load tickets
if (fs.existsSync(TICKETS_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
        ticketActivity = new Map(Object.entries(data));
    } catch (e) {
        console.error("Error loading tickets:", e);
    }
}

function saveTickets() {
    const data = Object.fromEntries(ticketActivity);
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(data, null, 2));
}

// Helper: Check Progress & Unlock
async function checkProgress(interaction, part) {
    const channelId = interaction.channel.id;

    // Initialize if empty
    if (!ticketProgress.has(channelId)) {
        ticketProgress.set(channelId, new Set());
    }

    // Add current part
    const progress = ticketProgress.get(channelId);
    progress.add(part);

    // Check if complete (3 parts: rules, req, loadout)
    if (progress.size >= 3) {
        // Unlock Chat
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
            SendMessages: true,
            ViewChannel: true
        });

        await interaction.followUp({
            content: '🎉 **You have read everything! Chat has been unlocked.**',
            ephemeral: true
        });

        // Optional: clear progress to save memory
        ticketProgress.delete(channelId);
    } else {
        const remaining = 3 - progress.size;
        await interaction.followUp({
            content: `✅ Read! (${progress.size}/3)\nPlease read ${remaining} more section(s) to unlock chat.`,
            ephemeral: true
        });
    }
}

// --- Commands Definition ---
const commands = [
    {
        name: 'setup-ticket',
        description: 'Set up the ticket creation panel',
        defaultMemberPermissions: PermissionsBitField.Flags.Administrator.toString(), // Visible only to Admins
    },
    {
        name: 'announce',
        description: 'Make an announcement',
        defaultMemberPermissions: PermissionsBitField.Flags.Administrator.toString(), // Visible only to Admins
        options: [
            {
                name: 'message',
                type: 3, // STRING
                description: 'The message to announce',
                required: true,
            },
            {
                name: 'channel',
                type: 7, // CHANNEL
                description: 'Channel to send to (optional)',
                required: false,
            }
        ]
    },
    {
        name: 'close',
        description: 'Close the current ticket',
        defaultMemberPermissions: PermissionsBitField.Flags.Administrator.toString(), // Visible only to Admins
    }
];

// --- Deploy Commands ---
async function deployCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('Started refreshing application (/) commands.');
        if (GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        } else {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        }
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
}

// --- Event: Ready ---
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Set bot presence (status + activity)
    client.user.setPresence({
        status: 'idle', // Options: 'online', 'idle', 'dnd', 'invisible'
        activities: [{
            name: 'Create Tickets for Any Issues',
            type: ActivityType.Playing
        }]
    });

    // Other status examples:
    // status: 'online'    → Green circle (default)
    // status: 'idle'      → Yellow/orange crescent moon
    // status: 'dnd'       → Red circle with line (Do Not Disturb)
    // status: 'invisible' → Appears offline (gray)

    await deployCommands();

    // Auto-Close Inactive Tickets Check (Every Hour)
    cron.schedule('0 * * * *', async () => {
        console.log('Running inactive ticket check...');
        const now = Date.now();
        const MAX_INACTIVE_MS = 72 * 60 * 60 * 1000; // 72 hours

        for (const [channelId, lastActive] of ticketActivity.entries()) {
            if (now - lastActive > MAX_INACTIVE_MS) {
                const channel = client.channels.cache.get(channelId);
                if (channel) {
                    try {
                        await channel.send("Ticket closed due to inactivity (72h).");
                        await channel.delete();
                        ticketActivity.delete(channelId);
                        saveTickets();
                    } catch (err) {
                        console.error(`Failed to close ticket ${channelId}:`, err);
                    }
                } else {
                    ticketActivity.delete(channelId);
                    saveTickets();
                }
            }
        }
    });
});

// --- Event: Interaction (Slash Commands & Buttons) ---
client.on('interactionCreate', async interaction => {
    try {
        // 1. SLASH COMMANDS
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            // --- PERMISSION CHECK HELPER ---
            const modRoleId = process.env.MOD_ROLE_ID;
            const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
            const hasModRole = modRoleId && interaction.member.roles.cache.has(modRoleId);

            // If user is neither Admin nor Mod, DENY interaction
            if (!isAdmin && !hasModRole) {
                return interaction.reply({
                    content: '⛔ Permission Denied: You must be an Administrator or a Moderator to use this command.',
                    ephemeral: true
                });
            }

            if (commandName === 'setup-ticket') {
                await interaction.deferReply({ ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle('tryout ticket')
                    .setDescription('Click the button below to create a ticket.')
                    .setColor('Blue')
                    .setImage('attachment://Rules_1.png');

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('create_ticket')
                            .setLabel('Create Ticket')
                            .setEmoji('📩')
                            .setStyle(ButtonStyle.Secondary)
                    );

                await interaction.channel.send({
                    embeds: [embed],
                    components: [row],
                    files: [{
                        attachment: path.join(__dirname, 'Rules_1.png'),
                        name: 'Rules_1.png'
                    }]
                });
                return interaction.editReply({ content: 'Ticket panel created!' });
            }

            if (commandName === 'announce') {
                await interaction.deferReply({ ephemeral: true });

                const message = interaction.options.getString('message');
                const channel = interaction.options.getChannel('channel') || interaction.channel;

                try {
                    await channel.send({ content: `**Announcement**\n\n${message}` });
                    return interaction.editReply({ content: 'Announcement sent!' });
                } catch (err) {
                    return interaction.editReply({ content: `Failed to send announcement: ${err.message}` });
                }
            }

            if (commandName === 'close') {
                // Check if this is a ticket channel
                if (!ticketActivity.has(interaction.channel.id) && !interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({ content: 'This command can only be used in ticket channels.', ephemeral: true });
                }

                // Permission check for close command
                const closeRole1 = process.env.CLOSE_ROLE_ID_1;
                const closeRole2 = process.env.CLOSE_ROLE_ID_2;
                const closeRole3 = process.env.CLOSE_ROLE_ID_3;

                const hasCloseRole1 = closeRole1 && interaction.member.roles.cache.has(closeRole1);
                const hasCloseRole2 = closeRole2 && interaction.member.roles.cache.has(closeRole2);
                const hasCloseRole3 = closeRole3 && interaction.member.roles.cache.has(closeRole3);

                // Check if user has permission (Admin, Mod, or any of the 3 close roles)
                if (!isAdmin && !hasModRole && !hasCloseRole1 && !hasCloseRole2 && !hasCloseRole3) {
                    return interaction.reply({
                        content: '⛔ You do not have permission to close tickets.',
                        ephemeral: true
                    });
                }

                await interaction.reply({ content: 'Closing ticket in 5 seconds... Generating transcript...' });

                // --- GENERATE TRANSCRIPT & DM USER ---
                try {
                    // 1. Fetch Messages (Limit 100)
                    const messages = await interaction.channel.messages.fetch({ limit: 100 });
                    const transcript = messages.reverse().map(m => {
                        const content = m.content;
                        const attachments = m.attachments.size > 0 ? ` [Attachments: ${m.attachments.map(a => a.url).join(', ')}]` : '';
                        return `${m.author.tag}: ${content}${attachments}`;
                    }).join('\n');

                    // 2. Create Buffer
                    const buffer = Buffer.from(`TRANSCRIPT FOR ${interaction.channel.name}\n\n${transcript}`, 'utf-8');

                    // 3. Find Ticket Creator (User with specific ViewChannel permission)
                    // We look for a Member overwrite that is NOT the bot
                    const overlays = interaction.channel.permissionOverwrites.cache;
                    const creatorOverwrite = overlays.find(p => p.type === 1 && p.id !== client.user.id);

                    if (creatorOverwrite) {
                        const creator = await interaction.guild.members.fetch(creatorOverwrite.id);
                        if (creator) {
                            await creator.send({
                                content: `Here is the transcript for your ticket **${interaction.channel.name}**.`,
                                files: [{
                                    attachment: buffer,
                                    name: `transcript-${interaction.channel.name}.txt`
                                }]
                            }).catch(err => console.log("Could not DM user transcript (blocked DMs?)"));
                        }
                    }

                } catch (err) {
                    console.error("Error generating transcript:", err);
                }

                setTimeout(async () => {
                    if (interaction.channel) {
                        try {
                            await interaction.channel.delete();
                            ticketActivity.delete(interaction.channel.id);
                            saveTickets();
                        } catch (e) {
                            console.error("Failed to delete channel:", e);
                        }
                    }
                }, 5000);
                return;
            }
        }

        // 2. BUTTONS (Ticket & FAQ)
        if (interaction.isButton()) {

            // --- Create Ticket ---
            if (interaction.customId === 'create_ticket') {
                await interaction.deferReply({ ephemeral: true });

                const guild = interaction.guild;
                const categoryId = process.env.TICKET_CATEGORY_ID;

                try {
                    // 1. Prepare Permissions
                    const permissions = [
                        {
                            id: guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: interaction.user.id,
                            allow: [PermissionsBitField.Flags.ViewChannel],
                            deny: [PermissionsBitField.Flags.SendMessages] // 🔒 LOCKED INITIALLY
                        },
                        {
                            id: client.user.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                        }
                    ];

                    // 2. Add Staff Roles (Mod + Extra Close Roles)
                    const staffRoles = [
                        process.env.MOD_ROLE_ID,
                        process.env.CLOSE_ROLE_ID_1,
                        process.env.CLOSE_ROLE_ID_2,
                        process.env.CLOSE_ROLE_ID_3
                    ];

                    for (const rawRoleId of staffRoles) {
                        if (rawRoleId) {
                            // Clean ID: Remove comments (stuff after #) and spaces
                            const roleId = rawRoleId.split('#')[0].trim();

                            // Validate: Only add if it's a valid number ID
                            if (/^\d{17,20}$/.test(roleId)) {
                                permissions.push({
                                    id: roleId,
                                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                                });
                            }
                        }
                    }

                    // 3. Create Channel
                    const channel = await guild.channels.create({
                        name: `ticket-${interaction.user.username}`,
                        type: ChannelType.GuildText,
                        parent: categoryId,
                        permissionOverwrites: permissions,
                    });

                    const embed = new EmbedBuilder()
                        .setTitle(`Hello ${interaction.user.username}`)
                        .setDescription('Welcome to support! 🔒 **Chat is locked.**\n\nPlease read **Instructions**, **Requirements**, and **Loadout** by clicking the buttons below to unlock the chat.')
                        .setColor('Blue')
                        .setImage('attachment://Rules_1.png'); // LINK TO ATTACHMENT

                    // Message 1: Welcome & FAQ
                    // Row 1: Information (Rules & Loadouts & Recruitment)
                    const faqRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder().setCustomId('faq_rules').setLabel('Instruction').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId('faq_requirment').setLabel('Requirement').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId('faq_loadout').setLabel('Loadout').setStyle(ButtonStyle.Secondary)
                        );

                    await channel.send({
                        content: `Hello ${interaction.user} | Welcome to support!`,
                        embeds: [embed],
                        components: [faqRow],
                        files: [{
                            attachment: path.join(__dirname, 'Rules_1.png'),
                            name: 'Rules_1.png'
                        }]
                    });

                    // BIG Warning Message
                    await channel.send({
                        content: "# 🛑 ACTION REQUIRED\n# 🔒 YOU MUST GO THROUGH ALL 3 TOPICS (Instruction, Requirement, Loadout) TO UNLOCK THE CHAT!\n### ⚠️ You cannot speak to Tryout Managers until you read everything."
                    });

                    ticketActivity.set(channel.id, Date.now());
                    saveTickets();

                    await interaction.editReply({ content: `Ticket created: ${channel}` });

                } catch (err) {
                    console.error("Error creating ticket:", err);
                    // Show the specific error to help debug
                    await interaction.editReply({ content: `Failed to create ticket.\n**Reason:** ${err.message}` });
                }
                return;
            }

            // --- FAQ Handlers ---
            if (interaction.customId === 'faq_rules') {
                await interaction.deferReply({ ephemeral: true });
                await interaction.editReply({
                    content: "## INSTRUCTIONS\n\n" +
                        "✅ **Make sure to wait for the tryout team to @ you and be patient.**\n\n" +
                        "🔗 **Please join through the link given or add the player for your tryouts.**\n\n" +
                        "🏆 **If you win against the tryout manager you're in the clan.**"
                });
                await checkProgress(interaction, 'rules');
            }

            if (interaction.customId === 'faq_loadout') {
                await interaction.deferReply({ ephemeral: true });
                await interaction.editReply({
                    content: "## LOADOUT\n\n" +
                        "1. **DL (Default Loadout)**\n" +
                        "          • Primary: AR\n" +
                        "          • Secondary: Handgun\n" +
                        "          • Melee: Fists\n" +
                        "          • Utility: Grenade\n\n" +
                        "2. **CL (Custom Loadout)**\n" +
                        "          • Anything is allowed\n" +
                        "          • Pay to Win items are not allowed\n\n" +
                        "3. **SRL (Sniper Restricted Loadout)**\n" +
                        "           • Primary: Sniper\n" +
                        "           • Secondary: Handgun / Revolver\n" +
                        "           • Melee: Fists / Scythe\n" +
                        "           • Utility: Grenade / Warhorn"
                });
                await checkProgress(interaction, 'loadout');
            }

            if (interaction.customId === 'faq_requirment') {
                await interaction.deferReply({ ephemeral: true });
                await interaction.editReply({
                    content: "## REQUIREMENTS\n\n" +
                        "**MUST BE 150+ LV ACCOUNT**\n\n" +
                        "**Rank:**\n" +
                        "• PLAT 1 OR HIGHER FOR PC\n" +
                        "• GOLD 2 FOR PHONE PLAYERS\n\n" +
                        "📸 **PLEASE MAKE SURE TO TAKE A PICTURE OF THE ACCOUNT YOU'RE GOING TO PLAY TRYOUTS.**\n" +
                        "Managers will ask you for your profile stats so make sure to keep it ready.",
                    files: [{
                        attachment: path.join(__dirname, 'requiremenets.png'),
                        name: 'requiremenets.png'
                    }]
                });
                await checkProgress(interaction, 'req');
            }
        }
    } catch (error) {
        console.error("Interaction Handler Crashed:", error);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (ticketActivity.has(message.channel.id)) {
        ticketActivity.set(message.channel.id, Date.now());
        saveTickets();
    }
});

// --- Event: New Member Welcome ---
client.on('guildMemberAdd', async member => {
    const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
    if (!welcomeChannelId) return;

    const channel = member.guild.channels.cache.get(welcomeChannelId);
    if (channel) {
        try {
            await channel.send({
                content: `Welcome ${member} to **${member.guild.name}**! This is the main chat where you can find yourself friends and have fun with them. Hope u have a great time! 🎉`
            });
        } catch (err) {
            console.error("Failed to send welcome message:", err);
        }
    }
});

client.login(TOKEN);
