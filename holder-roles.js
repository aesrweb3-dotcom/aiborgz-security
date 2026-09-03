const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ethers } = require('ethers');
const holderDb = require('./holder-database');

const BASE_URL = process.env.BASE_URL;
const CONTRACT_ADDRESS = process.env.AIBORGZ_CONTRACT_ADDRESS || '0xc086de91ea6f1e736ccd9032799dab0f07d063ff';
const RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com/';
const ERC721_ABI = ['function balanceOf(address) view returns (uint256)'];

// Highest threshold first - tierForBalance() returns the first one a
// holder's balance clears, so this order matters.
const TIERS = [
  { min: 50, name: 'CLASSIFIED',      envVar: 'ROLE_CLASSIFIED' },
  { min: 25, name: 'SEVERE THREAT',   envVar: 'ROLE_SEVERE_THREAT' },
  { min: 10, name: 'HIGH THREAT',     envVar: 'ROLE_HIGH_THREAT' },
  { min: 5,  name: 'MODERATE THREAT', envVar: 'ROLE_MODERATE_THREAT' },
  { min: 1,  name: 'LOW THREAT',      envVar: 'ROLE_LOW_THREAT' },
];

function allTierRoleIds() {
  return TIERS.map(t => process.env[t.envVar]).filter(Boolean);
}

function tierForBalance(balance) {
  return TIERS.find(t => balance >= t.min) || null;
}

async function getHolderBalance(walletAddress) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ERC721_ABI, provider);
  const balance = await contract.balanceOf(walletAddress);
  return Number(balance);
}

// Shared core logic - called right after verification AND on the periodic
// recheck, so a holder who buys or sells more later still ends up on the
// correct role, not just whatever it was the moment they first connected.
async function checkAndAssignTier(discordId, guildId, walletAddress, client) {
  const balance = await getHolderBalance(walletAddress);
  const tier = tierForBalance(balance);
  const targetRoleId = tier ? process.env[tier.envVar] : null;

  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return { balance, tier };

  for (const roleId of allTierRoleIds()) {
    if (roleId !== targetRoleId && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch(err =>
        console.error(`Holder roles: failed to remove role ${roleId} from ${discordId}:`, err.message));
    }
  }
  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId).catch(err =>
      console.error(`Holder roles: failed to add role ${targetRoleId} to ${discordId} - check the bot's role sits above the tier roles in Server Settings > Roles:`, err.message));
  }

  return { balance, tier };
}

const holderCommands = [
  new SlashCommandBuilder()
    .setName('holder-post-verify')
    .setDescription('Post the wallet verification entry message with a Verify button (admin only)')
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post the entry message in').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

async function handleHolderCommand(interaction) {
  if (interaction.commandName !== 'holder-post-verify') return;
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('channel');

  const tierList = TIERS.slice().reverse().map(t => `**${t.min}+** — ${t.name}`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(0x00e5ff)
    .setTitle('// HOLDER VERIFICATION //')
    .setDescription(
      `Click **Verify Wallet** below to connect your wallet and unlock your holder role.\n\n${tierList}\n\n` +
      `Free signature only - no transaction, no gas, nothing to approve. Your role updates automatically if your holdings change.`
    )
    .setFooter({ text: 'AIBORGZ Security // Holder Roles' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('holder_verify_button')
      .setLabel('Verify Wallet')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔗')
  );

  try {
    await channel.send({ embeds: [embed], components: [row] });
    await interaction.editReply(`Entry message posted in <#${channel.id}>.`);
  } catch (err) {
    console.error('holder-post-verify failed:', err.message);
    await interaction.editReply(
      `❌ Could not post there: ${err.message}. Check the bot has View Channel, Send Messages and Embed Links permission in <#${channel.id}>.`
    );
  }
}

async function handleHolderButton(interaction) {
  if (interaction.customId !== 'holder_verify_button') return;
  const user = interaction.user;
  const guildId = interaction.guild?.id;
  if (!guildId) return;

  const verifyUrl = `${BASE_URL}/wallet/start?discordId=${user.id}&guildId=${guildId}`;
  await interaction.reply({
    content:
      `Click below to connect your wallet and verify your holdings. Free signature, no transaction, ` +
      `no gas, we never ask you to send anything or approve any spending.\n\n` +
      `[**Verify Wallet →**](${verifyUrl})`,
    ephemeral: true,
  });
}

async function enforceHolderRoles(client) {
  const links = holderDb.getAllWalletLinks();
  for (const link of links) {
    try {
      await checkAndAssignTier(link.discord_id, link.guild_id, link.wallet_address, client);
    } catch (err) {
      console.error(`enforceHolderRoles error for ${link.discord_id}:`, err.message);
    }
  }
}

module.exports = {
  TIERS,
  holderCommands,
  handleHolderCommand,
  handleHolderButton,
  checkAndAssignTier,
  enforceHolderRoles,
};
