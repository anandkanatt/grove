// Platform bridge: expose the injected AppDeploy client to Grove's plain
// scripts as window.GrovePlatform. Module scripts finish before
// DOMContentLoaded, and Grove boots on DOMContentLoaded — so when this app
// runs on App Deploy the bridge is always ready first. On the GitHub Pages
// mirror or file:// this file simply isn't there, and Grove falls back to
// Supabase config or solo mode.
import { api, invitesClient, auth, notifications } from '@appdeploy/client';

(window as any).GrovePlatform = { api, invitesClient, auth, notifications };
