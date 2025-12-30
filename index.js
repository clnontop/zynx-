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
    Routes
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
                const embed = new EmbedBuilder()
                    .setTitle('Support Tickets')
                    .setDescription('Click the button below to open a support ticket.')
                    .setColor('Blue');

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('create_ticket')
                            .setLabel('Open Ticket')
                            .setStyle(ButtonStyle.Secondary)
                    );

                await interaction.channel.send({ embeds: [embed], components: [row] });
                return interaction.reply({ content: 'Ticket panel created!', ephemeral: true });
            }

            if (commandName === 'announce') {
                const message = interaction.options.getString('message');
                const channel = interaction.options.getChannel('channel') || interaction.channel;

                try {
                    await channel.send({ content: `**Announcement**\n\n${message}` });
                    return interaction.reply({ content: 'Announcement sent!', ephemeral: true });
                } catch (err) {
                    return interaction.reply({ content: `Failed to send announcement: ${err.message}`, ephemeral: true });
                }
            }

            if (commandName === 'close') {
                // Check if this is a ticket channel
                if (!ticketActivity.has(interaction.channel.id) && !interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({ content: 'This command can only be used in ticket channels.', ephemeral: true });
                }

                await interaction.reply({ content: 'Closing ticket in 5 seconds...' });
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
                    const channel = await guild.channels.create({
                        name: `ticket-${interaction.user.username}`,
                        type: ChannelType.GuildText,
                        parent: categoryId,
                        permissionOverwrites: [
                            {
                                id: guild.id,
                                deny: [PermissionsBitField.Flags.ViewChannel],
                            },
                            {
                                id: interaction.user.id,
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                            },
                            {
                                id: client.user.id,
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                            }
                        ],
                    });

                    const embed = new EmbedBuilder()
                        .setTitle(`Hello ${interaction.user.username}`)
                        .setDescription('Welcome to support! Choose an option below to get instant help, or wait for a staff member.')
                        .setColor('Blue')
                        .setImage('attachment://Rules_1.png'); // LINK TO ATTACHMENT

                    // Message 1: Welcome & FAQ
                    // Row 1: Information (Rules & Loadouts & Recruitment)
                    const faqRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder().setCustomId('faq_rules').setLabel('Server Rules').setEmoji('📜').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId('faq_loadout').setLabel('Best Loadout?').setEmoji('🔫').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId('faq_recruit').setLabel('How to Join?').setEmoji('🤝').setStyle(ButtonStyle.Secondary)
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

                    ticketActivity.set(channel.id, Date.now());
                    saveTickets();

                    await interaction.editReply({ content: `Ticket created: ${channel}` });

                } catch (err) {
                    console.error("Error creating ticket:", err);
                    await interaction.editReply({ content: 'Failed to create ticket. Check bot permissions.' });
                }
                return;
            }

            // --- FAQ Handlers ---
            if (interaction.customId === 'faq_rules') {
                await interaction.deferReply({ ephemeral: true });
                await interaction.editReply({
                    content: "**Server Rules:**\n1. Be respectful.\n2. No spamming.\n3. Follow Discord TOS."
                });
            }

            if (interaction.customId === 'faq_loadout') {
                await interaction.deferReply({ ephemeral: true });
                await interaction.editReply({
                    content: "**Recommended Loadout:**\n- Primary: M4A1 (Meta Build)\n- Secondary: Renetti\n- Perk: Ghost"
                });
            }

            if (interaction.customId === 'faq_recruit') {
                await interaction.deferReply({ ephemeral: true });
                await interaction.editReply({
                    content: "**How to Join:**\nFill out the application form in #apply channel and wait for an officer to review it."
                });
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

client.login(TOKEN);
