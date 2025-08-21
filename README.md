# ⚡ VouchBot

**VouchBot** is a modern Discord bot designed to bring **trust** and **reputation management** to your server.
It lets members give **vouches**, track **leaderboards**, manage **profiles**, and provides **admin-only tools** to keep communities safe.

---

## 🚀 Features

* 📋 **Vouches** – Add, view, and manage user vouches with reasons & history.
* 🏆 **Leaderboards** – Highlight your most trusted members.
* 🔒 **Admin Tools** – Blacklists, purge, and vouch removal for server staff only.
* 📊 **User Profiles** – See how much reputation a member has.
* ⚡ **Easy Setup** – Configure admin role & log channel with simple commands.

---

## 📖 Getting Started

### 1️⃣ Invite the bot OR Use the Open Source Code

[Click here to invite VouchBot](https://discord.com/api/oauth2/authorize?client_id=1396055418169589770&permissions=8&scope=bot%20applications.commands)

## Using Open Source

**First enter this command**
```
npm install
```

**Replace the** *YOUR_CLIENT_ID* **With your actual Client ID**
```
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID'
```
**Replace the** *YOUR_BOT_TOKEN* **With your actual Bot Toke**
```
const TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN'
```

**Replace the** *YOUR_SUPABASE_URL* **With your actuall SupaBase Url**
```
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL'
```
**Replace the** *YOUR_SUPABASE_KEY **With your actuall SupaBase Key**
```
const SUPABASE_KEY = process.env.SUPABASE_URL || 'YOUR_SUPABASE_KEY'
```

### 2️⃣ Set an Admin Role

Admins must run:

```
/setadminrole <@role>
```

This defines which role can access **admin-only commands**.

### 3️⃣ (Optional) Set a Log Channel

```
/setlogchannel <#channel>
```

This channel will record all vouch activity and blacklist actions.

---

## 📌 Commands

### 👥 Vouch Commands

* `/vouch <@user> <reason>` → Give a vouch to a user.
* `/profile <@user>` → View a user’s vouch profile & stats.
* `/leaderboard` → Show top vouched members.

### ⚙️ Admin Commands

*(Require the configured admin role or Discord Administrator permission)*

* `/removevouch <vouch_id>` → Remove a vouch.
* `/blacklist add <@user> <reason>` → Add user to server blacklist.
* `/blacklist remove <@user>` → Remove user from blacklist.
* `/blacklist list` → View blacklisted users.
* `/setadminrole <@role>` → Set admin role.
* `/setlogchannel <#channel>` → Set log channel.

---

## 📊 Example Usage

**Give a vouch:**

```
/vouch @Michael Quick and reliable trade!
```

**View someone’s profile:**

```
/profile @Michael
```

**See leaderboard:**

```
/leaderboard
```

**Admin removes a false vouch:**

```
/removevouch 15
```

---

## 🔒 Permissions

* The bot requires `Send Messages`, `Embed Links`, and `Manage Messages` for logging.
* Admin-only commands require either:

  * The configured **admin role**, or
  * Discord’s native **Administrator permission**.

---

## ❤️ Support

Having issues? Open an issue or ask in your support server.