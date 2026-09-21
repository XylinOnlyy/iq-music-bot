# Iq Music Bot

A Discord music bot that plays from **YouTube** and **Spotify** (tracks, albums, playlists), with button controls, loop modes, auto-leave, and a `/download` command for **TikTok**, **YouTube** and **Instagram**.

## Features

- `/play` with a song name, YouTube video/playlist link, or Spotify track/album/playlist/artist link
- Control buttons on the "Now Playing" message: Pause/Resume, Skip, Loop (Off → Track → Queue), Stop, Shuffle, Queue, Leave
- Loop the current track or the whole queue/playlist
- Leaves automatically after 10 minutes with nothing playing, or 2 minutes after everyone leaves the channel
- `/download` for TikTok videos and photo slideshows, YouTube videos, and Instagram reels/posts. The bot picks the best quality that fits your server's upload limit.
- Only people in the same voice channel as the bot can control it

## Commands

| Command | Description |
| --- | --- |
| `/help` | Show all commands |
| `/join` | Join your voice channel (you must be in one) |
| `/play <query>` | Play or queue a song/playlist |
| `/pause`, `/resume` | Pause / resume |
| `/skip` | Skip the current track |
| `/stop` | Stop and clear the queue (bot stays, leaves after the idle timeout) |
| `/leave` | Leave the voice channel |
| `/loop [off/track/queue]` | Set or cycle the loop mode |
| `/queue [page]` | Show the queue |
| `/nowplaying` | Re-send the player with control buttons |
| `/shuffle` | Shuffle the queue |
| `/remove <position>` | Remove a track from the queue |
| `/clear` | Clear upcoming tracks |
| `/download <link>` | Download from TikTok, YouTube or Instagram |

## Setup

Requirements: **Node.js 22.12 or newer**. FFmpeg and yt-dlp are downloaded automatically.

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications), add a bot, and copy its token.
2. Invite the bot with the `bot` and `applications.commands` scopes and these permissions: View Channels, Send Messages, Embed Links, Attach Files, Connect, Speak.
3. Install and configure:
   ```bash
   npm install
   cp .env.example .env   # then put your DISCORD_TOKEN in .env
   ```
4. Check that everything works from your machine, then start the bot:
   ```bash
   npm test        # unit tests
   npm run check   # live checks: yt-dlp, YouTube, Spotify, streaming, downloads
   npm start
   ```

Slash commands are registered automatically on startup. Set `GUILD_ID` while testing so they show up in your server immediately.

## Notes

- **Spotify** doesn't allow streaming its audio, so each Spotify track is matched to the same song on YouTube (compared by title, artist and duration). Without `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`, playlists are limited to their first 100 tracks.
- **yt-dlp updates itself** on every start. If YouTube playback breaks, restarting the bot usually fixes it.
- **Hosting on a VPS:** YouTube often blocks datacenter IPs ("Sign in to confirm you're not a bot"). If that happens, export cookies from a logged-in browser to a `cookies.txt` file and set `YTDLP_COOKIES`. The same cookies file also helps with Instagram posts that need a login.
- **Upload limits:** 10 MB by default, 50 MB for Boost level 2, and 100 MB for level 3. Videos too large for the limit are rejected with a message.
- For TikTok photo posts, the bot reads the TikTok page and falls back to the public tikwm.com API if that fails.
