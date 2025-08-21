const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  REST,
  Routes,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  ChannelType
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// =====================
// CONFIG
// =====================
const TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID';
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'YOUR_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// =====================
// CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const startTime = Date.now();

// =====================
// HELPERS
// =====================
function hasDiscordAdmin(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

async function getGuildSettings(guildId) {
  const { data, error } = await supabase
    .from('guild_settings')
    .select('*')
    .eq('guild_id', guildId)
    .single();
  if (error || !data) {
    await supabase.from('guild_settings').upsert({ guild_id: guildId });
    return { guild_id: guildId, decay_half_life_days: 180 };
  }
  return data;
}

function formatDuration(ms) {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${d}d ${h}h ${m}m ${s}s`;
}

async function sendLog(guild, settings, embed) {
  try {
    if (!settings?.log_channel_id) return;
    const ch = guild.channels.cache.get(settings.log_channel_id) || await guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    await ch.send({ embeds: [embed] });
  } catch (_) { /* noop */ }
}

function weightForDate(ts, halfLifeDays = 180) {
  try {
    const now = Date.now();
    const t = new Date(ts).getTime();
    const ageDays = Math.max(0, (now - t) / 86400000);
    if (!halfLifeDays || halfLifeDays <= 0) return 1;
    return Math.pow(0.5, ageDays / halfLifeDays);
  } catch (_) {
    return 1;
  }
}

function badgeForCount(count) {
  if (count >= 100) return '💠 Centurion (100+)';
  if (count >= 50) return '🏅 Gold (50+)';
  if (count >= 10) return '⭐ Bronze (10+)';
  return '—';
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function makePagerComponents(page, totalPages, ownerId, targetId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pv_prev_${ownerId}_${targetId}_${page}_${totalPages}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`pv_next_${ownerId}_${targetId}_${page}_${totalPages}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );
}

// =====================
// COMMAND DEFINITIONS
// =====================
const cmdDefs = {
  vouch: new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('Vouch for another user')
    .addUserOption(o => o.setName('user').setDescription('User to vouch for').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason (max 500)').setMaxLength(500).setRequired(true)),

  vouches: new SlashCommandBuilder()
    .setName('vouches')
    .setDescription('View vouches for a user (with pagination)')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  removevouch: new SlashCommandBuilder()
    .setName('removevouch')
    .setDescription('[Admin] Remove a vouch by ID (or by voucher)')
    .addIntegerOption(o => o.setName('id').setDescription('Vouch ID').setRequired(true)),

  stats: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show given/received stats for a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  leaderboard: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top users by received vouches'),

  topvouchers: new SlashCommandBuilder()
    .setName('topvouchers')
    .setDescription('Top users by given vouches'),

  adminpurge: new SlashCommandBuilder()
    .setName('adminpurge')
    .setDescription('[Admin] Purge all vouches for a user')
    .addUserOption(o => o.setName('user').setDescription('User to purge').setRequired(true)),

  setadminrole: new SlashCommandBuilder()
    .setName('setadminrole')
    .setDescription('[Admin] Choose which role is allowed to use admin-only commands')
    .addRoleOption(o => o.setName('role').setDescription('Admin role').setRequired(true)),

  setlogchannel: new SlashCommandBuilder()
    .setName('setlogchannel')
    .setDescription('[Admin] Set the channel where actions are logged')
    .addChannelOption(o => o.setName('channel').setDescription('Text channel').setRequired(true)),

  settrustedrole: new SlashCommandBuilder()
    .setName('settrustedrole')
    .setDescription('[Admin] Only members with this role can give vouches (set to none to disable)')
    .addRoleOption(o => o.setName('role').setDescription('Trusted role').setRequired(true)),

  blacklist: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('[Admin] Manage blacklist')
    .addSubcommand(sc => sc
      .setName('add').setDescription('Add a user to blacklist')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('remove').setDescription('Remove a user from blacklist')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sc => sc.setName('list').setDescription('List blacklisted users')),

  profile: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show user profile: stats, reputation, badges')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  exportvouches: new SlashCommandBuilder()
    .setName('exportvouches')
    .setDescription('[Admin] Export a user\'s vouches as CSV (DM)')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  globalstats: new SlashCommandBuilder()
    .setName('globalstats')
    .setDescription('Show cross-server given/received stats for a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  uptime: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Show how long the bot has been running')
};

// Which are admin-only (require admin role or Discord Admin)
const ADMIN_COMMANDS = new Set(['removevouch', 'adminpurge', 'setadminrole', 'setlogchannel', 'settrustedrole', 'blacklist', 'exportvouches']);

// =====================
// REGISTER COMMANDS
// =====================
async function registerCommands() {
  const list = Object.values(cmdDefs).map(b => b.toJSON());
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: list });
  console.log('✅ Slash commands registered.');
}

// =====================
// PERMISSION CHECKS
// =====================
async function isAdminUser(interaction) {
  const member = interaction.member;
  if (!member) return false;
  if (hasDiscordAdmin(member)) return true;
  const settings = await getGuildSettings(interaction.guild.id);
  if (settings?.admin_role_id) {
    return member.roles.cache.has(settings.admin_role_id);
    }
  return false;
}

async function ensureAdmin(interaction) {
  if (!(await isAdminUser(interaction))) {
    await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    return false;
  }
  return true;
}

// =====================
// BOT READY
// =====================
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  await registerCommands();
});

// =====================
// INTERACTIONS
// =====================
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (ADMIN_COMMANDS.has(name)) {
        if (!(await isAdminUser(interaction))) {
          return interaction.reply({ content: '🔒 This command is available only to the configured Admin role or Discord Administrators.', ephemeral: true });
        }
      }

      switch (name) {
        case 'vouch': return cmdVouch(interaction);
        case 'vouches': return cmdVouches(interaction);
        case 'removevouch': return cmdRemoveVouch(interaction);
        case 'stats': return cmdStats(interaction);
        case 'leaderboard': return cmdLeaderboard(interaction);
        case 'topvouchers': return cmdTopVouchers(interaction);
        case 'adminpurge': return cmdAdminPurge(interaction);
        case 'setadminrole': return cmdSetAdminRole(interaction);
        case 'setlogchannel': return cmdSetLogChannel(interaction);
        case 'settrustedrole': return cmdSetTrustedRole(interaction);
        case 'blacklist': return cmdBlacklist(interaction);
        case 'profile': return cmdProfile(interaction);
        case 'exportvouches': return cmdExportVouches(interaction);
        case 'globalstats': return cmdGlobalStats(interaction);
        case 'uptime': return cmdUptime(interaction);
      }
    } else if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('pv_prev_') || id.startsWith('pv_next_')) return handlePager(interaction);
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: '❌ Error processing command.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ Error processing command.', ephemeral: true });
    }
  }
});

// =====================
// COMMAND IMPLEMENTATIONS
// =====================
async function cmdVouch(interaction) {
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const voucher = interaction.user;
  const guild = interaction.guild;
  const settings = await getGuildSettings(guild.id);

  if (target.id === voucher.id) return interaction.reply({ content: '⚠️ You cannot vouch for yourself.', ephemeral: true });
  if (target.bot) return interaction.reply({ content: '⚠️ You cannot vouch for bots.', ephemeral: true });

  if (settings?.trusted_role_id) {
    const member = await guild.members.fetch(voucher.id);
    if (!member.roles.cache.has(settings.trusted_role_id) && !hasDiscordAdmin(member)) {
      return interaction.reply({ content: '🔒 Only members with the configured Trusted role can give vouches.', ephemeral: true });
    }
  }

  const { data: blv } = await supabase.from('blacklist').select('id').eq('guild_id', guild.id).eq('user_id', voucher.id).maybeSingle();
  if (blv) return interaction.reply({ content: '🚫 You are blacklisted from giving vouches in this server.', ephemeral: true });
  const { data: blt } = await supabase.from('blacklist').select('id').eq('guild_id', guild.id).eq('user_id', target.id).maybeSingle();
  if (blt) return interaction.reply({ content: '🚫 The target user is blacklisted and cannot receive vouches.', ephemeral: true });

  const { data, error } = await supabase.from('vouches').insert([{
    voucher_id: voucher.id, voucher_name: voucher.username, voucher_tag: voucher.discriminator || '0000',
    target_id: target.id, target_name: target.username, target_tag: target.discriminator || '0000',
    reason, guild_id: guild.id, removed: false
  }]).select().single();

  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('✅ Vouch Added')
    .addFields(
      { name: 'Voucher', value: `${voucher}`, inline: true },
      { name: 'Target', value: `${target}`, inline: true },
      { name: 'Reason', value: reason }
    )
    .setFooter({ text: `Vouch ID: ${data.id}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });

  await sendLog(guild, settings, new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('📝 Vouch Created')
    .setDescription(`ID: **${data.id}**`)
    .addFields(
      { name: 'Voucher', value: `${voucher.tag || voucher.username}`, inline: true },
      { name: 'Target', value: `${target.tag || target.username}`, inline: true },
      { name: 'Reason', value: reason }
    )
    .setTimestamp());
}

async function cmdVouches(interaction) {
  const target = interaction.options.getUser('user');
  const { data: rows, error } = await supabase
    .from('vouches')
    .select('*')
    .eq('target_id', target.id)
    .eq('guild_id', interaction.guild.id)
    .eq('removed', false)
    .order('timestamp', { ascending: false });
  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
  if (!rows || !rows.length) return interaction.reply({ content: `${target} has no vouches.`, ephemeral: true });
  // jols1337 coded this whole thing <3
  const pages = chunk(rows, 10);
  const page = 0;
  const totalPages = pages.length;

  const embed = buildVouchesEmbed(target, pages[page], page, totalPages);
  const comps = makePagerComponents(page, totalPages, interaction.user.id, target.id);
  await interaction.reply({ embeds: [embed], components: [comps] });
}

function buildVouchesEmbed(target, entries, page, totalPages) {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`📋 Vouches for ${target.username}`)
    .setThumbnail(target.displayAvatarURL())
    .setFooter({ text: `Page ${page + 1} / ${totalPages} | target:${target.id}` })
    .setTimestamp();

  for (const v of entries) {
    const date = new Date(v.timestamp).toLocaleString();
    embed.addFields({ name: `${v.voucher_name}#${v.voucher_tag} (ID: ${v.id})`, value: `**Reason:** ${v.reason}
**Date:** ${date}` });
  }
  return embed;
}

async function handlePager(interaction) {
  const [pv, dir, ownerId, targetId, pageStr, totalStr] = interaction.customId.split('_');
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: '⛔ Only the requester can use these buttons.', ephemeral: true });
  }
  const inc = dir === 'prev' ? -1 : 1;
  const currentPage = parseInt(pageStr, 10);
  const totalPages = parseInt(totalStr, 10);
  let newPage = currentPage + inc;
  if (newPage < 0) newPage = 0;
  if (newPage >= totalPages) newPage = totalPages - 1;

  const { data: rows, error } = await supabase
    .from('vouches')
    .select('*')
    .eq('target_id', targetId)
    .eq('guild_id', interaction.guild.id)
    .eq('removed', false)
    .order('timestamp', { ascending: false });
  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
  const pages = chunk(rows || [], 10);
  const entries = pages[newPage] || [];

  const targetUser = await client.users.fetch(targetId).catch(() => ({ username: 'User', id: targetId, displayAvatarURL: () => null }));
  const newEmbed = buildVouchesEmbed(targetUser, entries, newPage, pages.length || 1);
  const comps = makePagerComponents(newPage, pages.length || 1, interaction.user.id, targetId);
  await interaction.update({ embeds: [newEmbed], components: [comps] });
}

async function cmdRemoveVouch(interaction) {
  const id = interaction.options.getInteger('id');
  
  const { data: v, error } = await supabase.from('vouches').select('*').eq('id', id).single();
  if (error || !v || v.removed) return interaction.reply({ content: '❌ Vouch not found or already removed.', ephemeral: true });

  const isSelf = v.voucher_id === interaction.user.id;
  if (!isSelf && !(await isAdminUser(interaction))) {
    return interaction.reply({ content: '🔒 You can only remove your own vouches (or be an Admin).', ephemeral: true });
  }

  const { error: upErr } = await supabase.from('vouches').update({ removed: true }).eq('id', id);
  if (upErr) return interaction.reply({ content: `❌ DB error: ${upErr.message}`, ephemeral: true });

  const embed = new EmbedBuilder().setColor(0xffa500).setTitle('🗑️ Vouch Removed').setDescription(`Removed vouch ID **${id}**`);
  await interaction.reply({ embeds: [embed] });

  const settings = await getGuildSettings(interaction.guild.id);
  await sendLog(interaction.guild, settings, new EmbedBuilder().setColor(0x2b2d31).setTitle('🗑️ Vouch Removed').setDescription(`ID: **${id}** by ${interaction.user.tag}`));
}

async function cmdStats(interaction) {
  const user = interaction.options.getUser('user');
  const guildId = interaction.guild.id;
  const { data: gvn } = await supabase.from('vouches').select('id', { count: 'exact' }).eq('voucher_id', user.id).eq('guild_id', guildId).eq('removed', false);
  const { data: rcv } = await supabase.from('vouches').select('id', { count: 'exact' }).eq('target_id', user.id).eq('guild_id', guildId).eq('removed', false);

  const given = gvn ? gvn.length : 0;
  const received = rcv ? rcv.length : 0;

  const embed = new EmbedBuilder()
    .setColor(0x00aaff)
    .setTitle(`📊 Stats for ${user.username}`)
    .addFields(
      { name: 'Received', value: String(received), inline: true },
      { name: 'Given', value: String(given), inline: true }
    )
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function cmdLeaderboard(interaction) {
  const guildId = interaction.guild.id;
  const { data: rows, error } = await supabase
    .from('vouches')
    .select('target_id,target_name,target_tag')
    .eq('guild_id', guildId)
    .eq('removed', false)
    .order('timestamp', { ascending: false });
  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
  if (!rows?.length) return interaction.reply({ content: '📋 No leaderboard data found.', ephemeral: true });

  const counts = new Map();
  for (const r of rows) {
    const key = `${r.target_id}|${r.target_name}|${r.target_tag}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const desc = sorted.map((e, i) => {
    const [id, name, tag] = e[0].split('|');
    return `**${i + 1}. ${name}#${tag}** — ${e[1]}`;
  }).join(' ');

  const embed = new EmbedBuilder().setColor(0xffaa00).setTitle('🏆 Vouch Leaderboard').setDescription(desc);
  await interaction.reply({ embeds: [embed] });
}

async function cmdTopVouchers(interaction) {
  const guildId = interaction.guild.id;
  const { data: rows, error } = await supabase
    .from('vouches')
    .select('voucher_id,voucher_name,voucher_tag')
    .eq('guild_id', guildId)
    .eq('removed', false)
    .order('timestamp', { ascending: false });
  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
  if (!rows?.length) return interaction.reply({ content: '📋 No data found.', ephemeral: true });

  const counts = new Map();
  for (const r of rows) {
    const key = `${r.voucher_id}|${r.voucher_name}|${r.voucher_tag}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const desc = sorted.map((e, i) => {
    const [id, name, tag] = e[0].split('|');
    return `**${i + 1}. ${name}#${tag}** — ${e[1]}`;
  }).join('');

  const embed = new EmbedBuilder().setColor(0x55aa55).setTitle('🏆 Top Vouchers (Given)').setDescription(desc);
  await interaction.reply({ embeds: [embed] });
}

async function cmdAdminPurge(interaction) {
  if (!(await ensureAdmin(interaction))) return;
  const user = interaction.options.getUser('user');
  const { error } = await supabase
    .from('vouches')
    .update({ removed: true })
    .eq('target_id', user.id)
    .eq('guild_id', interaction.guild.id)
    .eq('removed', false);

  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });

  const embed = new EmbedBuilder().setColor(0xcc3333).setTitle('🧹 Purge Complete').setDescription(`Purged vouches for ${user.tag || user.username}.`);
  await interaction.reply({ embeds: [embed] });
  const settings = await getGuildSettings(interaction.guild.id);
  await sendLog(interaction.guild, settings, new EmbedBuilder().setColor(0x2b2d31).setTitle('🧹 Admin Purge').setDescription(`${interaction.user.tag} purged for ${user.tag}`));
}

async function cmdSetAdminRole(interaction) {
  // Only users with actual Discord Administrator perms can set admin role
  if (!hasDiscordAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ Only users with Discord **Administrator** permission can set the Admin role.', ephemeral: true });
  }
  const role = interaction.options.getRole('role');
  const { error } = await supabase
    .from('guild_settings')
    .upsert({ guild_id: interaction.guild.id, admin_role_id: role.id });
  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
  await interaction.reply({ content: `✅ Admin role set to **@${role.name}**.`, ephemeral: true });
}

async function cmdSetLogChannel(interaction) {
  if (!(await ensureAdmin(interaction))) return;
  const channel = interaction.options.getChannel('channel');
  if (channel.type !== ChannelType.GuildText) {
    return interaction.reply({ content: '❌ Please select a text channel.', ephemeral: true });
  }
  const { error } = await supabase
    .from('guild_settings')
    .upsert({ guild_id: interaction.guild.id, log_channel_id: channel.id });
  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
  await interaction.reply({ content: `✅ Log channel set to ${channel}.`, ephemeral: true });
}

async function cmdSetTrustedRole(interaction) {
  if (!(await ensureAdmin(interaction))) return;
  const role = interaction.options.getRole('role');
  const { error } = await supabase
    .from('guild_settings')
    .upsert({ guild_id: interaction.guild.id, trusted_role_id: role.id });
  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
  await interaction.reply({ content: `✅ Trusted role set to **@${role.name}**. Only members with this role (or Admins) can give vouches.`, ephemeral: true });
}

async function cmdBlacklist(interaction) {
  if (!(await ensureAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const settings = await getGuildSettings(guildId);

  if (sub === 'add') {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const { error } = await supabase
      .from('blacklist')
      .insert({ guild_id: guildId, user_id: user.id, added_by: interaction.user.id, reason });

    if (error) {
      if (String(error.message).toLowerCase().includes('duplicate')) {
        await interaction.reply({ content: '⚠️ User is already blacklisted.', ephemeral: true });
      } else {
        return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
      }
    } else {
      await interaction.reply({ content: `✅ ${user.tag || user.username} added to blacklist.`, ephemeral: true });
      await sendLog(interaction.guild, settings, new EmbedBuilder().setColor(0x2b2d31).setTitle('🚫 Blacklist Add').setDescription(`${user.tag} — ${reason}`));
    }
  } else if (sub === 'remove') {
    const user = interaction.options.getUser('user');
    const { error } = await supabase
      .from('blacklist')
      .delete()
      .eq('guild_id', guildId)
      .eq('user_id', user.id);

    if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
    await interaction.reply({ content: `✅ ${user.tag || user.username} removed from blacklist.`, ephemeral: true });
    await sendLog(interaction.guild, settings, new EmbedBuilder().setColor(0x2b2d31).setTitle('⚠️ Blacklist Remove').setDescription(`${user.tag}`));
  } else if (sub === 'list') {
    const { data: rows, error } = await supabase
      .from('blacklist')
      .select('*')
      .eq('guild_id', guildId)
      .order('timestamp', { ascending: false });
    if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
    if (!rows?.length) return interaction.reply({ content: '👍 Blacklist is empty.', ephemeral: true });
    const desc = rows.map(r => `• <@${r.user_id}> — ${r.reason || 'No reason'} (by <@${r.added_by}>)`).join('');
    const embed = new EmbedBuilder().setColor(0x333333).setTitle('🚫 Blacklisted Users').setDescription(desc);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function cmdProfile(interaction) {
  const user = interaction.options.getUser('user');
  const guildId = interaction.guild.id;
  const settings = await getGuildSettings(guildId);

  const { data: received } = await supabase
    .from('vouches')
    .select('*')
    .eq('target_id', user.id)
    .eq('guild_id', guildId)
    .eq('removed', false);
  const { data: givenRows } = await supabase
    .from('vouches')
    .select('id')
    .eq('voucher_id', user.id)
    .eq('guild_id', guildId)
    .eq('removed', false);

  const given = givenRows ? givenRows.length : 0;
  const recCount = received ? received.length : 0;
  const rep = (received || []).reduce((sum, v) => sum + weightForDate(v.timestamp, settings.decay_half_life_days || 180), 0);
  const badge = badgeForCount(recCount);

  const embed = new EmbedBuilder()
    .setColor(0x7289da)
    .setTitle(`👤 Profile — ${user.username}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Vouches Received', value: String(recCount), inline: true },
      { name: 'Vouches Given', value: String(given), inline: true },
      { name: 'Reputation (decayed)', value: rep.toFixed(2), inline: true },
      { name: 'Badge', value: badge, inline: true }
    )
    .setTimestamp();

  const recent = (received || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);
  if (recent.length) {
    embed.addFields({ name: 'Recent Vouches', value: recent.map(r => `• ${r.voucher_name}#${r.voucher_tag}: ${r.reason}`).join('') });
  }

  const { data: bl } = await supabase.from('blacklist').select('id').eq('guild_id', guildId).eq('user_id', user.id).maybeSingle();
  if (bl) embed.addFields({ name: 'Status', value: '🚫 Blacklisted', inline: true });

  await interaction.reply({ embeds: [embed] });
}

async function cmdExportVouches(interaction) {
  if (!(await ensureAdmin(interaction))) return;
  const user = interaction.options.getUser('user');
  const { data: rows, error } = await supabase
    .from('vouches')
    .select('*')
    .eq('target_id', user.id)
    .eq('guild_id', interaction.guild.id)
    .order('timestamp', { ascending: false });
  if (error) return interaction.reply({ content: `❌ DB error: ${error.message}`, ephemeral: true });
  if (!rows?.length) return interaction.reply({ content: 'No vouches to export.', ephemeral: true });

  const headers = ['id','voucher_id','voucher_name','voucher_tag','target_id','target_name','target_tag','reason','timestamp','guild_id','removed'];
  const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => {
    const val = r[h] == null ? '' : String(r[h]).replaceAll('"', '""');
    return '"' + val + '"';
  }).join(','))).join('');

  const fileName = `vouches_${user.id}.csv`;
  const filePath = path.join(__dirname, fileName);
  fs.writeFileSync(filePath, csv, 'utf8');

  try {
    await interaction.user.send({ content: `Here is the export for **${user.tag}**`, files: [filePath] });
    await interaction.reply({ content: '📤 Export sent via DM.', ephemeral: true });
  } catch (e) {
    await interaction.reply({ content: '⚠️ Could not DM you the file. Check your privacy settings.', ephemeral: true });
  } finally {
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

async function cmdGlobalStats(interaction) {
  const user = interaction.options.getUser('user');
  const { data: gvn } = await supabase.from('vouches').select('id').eq('voucher_id', user.id).eq('removed', false);
  const { data: rcv } = await supabase.from('vouches').select('id').eq('target_id', user.id).eq('removed', false);
  const embed = new EmbedBuilder().setColor(0x00cc99).setTitle(`🌐 Global Stats — ${user.username}`).addFields(
    { name: 'Received (all servers)', value: String(rcv ? rcv.length : 0), inline: true },
    { name: 'Given (all servers)', value: String(gvn ? gvn.length : 0), inline: true }
  );
  await interaction.reply({ embeds: [embed] });
}

async function cmdUptime(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('⏱️ Bot Uptime')
    .setDescription(formatDuration(Date.now() - startTime))
    .addFields(
      { name: 'Started', value: `<t:${Math.floor(startTime / 1000)}:F>` },
      { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
      { name: 'Ping', value: `${client.ws.ping}ms`, inline: true }
    );
  await interaction.reply({ embeds: [embed] });
}

// =====================
// ERROR HANDLING & SHUTDOWN
// =====================
process.on('unhandledRejection', (e) => console.error('UnhandledRejection:', e));
client.on('error', (e) => console.error('ClientError:', e));

process.on('SIGINT', () => {
  console.log('🔄 Gracefully shutting down...');
  process.exit(0);
});

// =====================
// LOGIN
// =====================
client.login(TOKEN).catch(e => console.error('Login error:', e));
