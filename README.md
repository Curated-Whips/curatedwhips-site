# Curated Whips — Website

A 5-page static site: Home, Services, About, Testimonials, Contact. No build step, no dependencies beyond Google Fonts — plain HTML/CSS/JS, so it deploys anywhere for free.

## Ready to launch

Your Calendly link and headshot are both in place — nothing left to swap before deploying. If you later create separate Calendly event types for "Find it for Me" and "White Glove" (rather than one shared intro-call link), update the two service-specific buttons in `services.html` (the "Book This Service" links) to point at those instead.

## Deploying for free (GitHub + Vercel)

1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Create a new repository (e.g. `curatedwhips-site`) and upload all files in this folder, keeping the folder structure (`css/`, `js/` subfolders included).
3. Create a free account at [vercel.com](https://vercel.com), sign in with GitHub.
4. Click "Add New Project," select your `curatedwhips-site` repo, and click Deploy — no configuration needed, it's a static site.
5. Vercel gives you a live `.vercel.app` URL immediately. To use curatedwhips.com instead: in Vercel, go to your project → Settings → Domains → add `curatedwhips.com`. Vercel will show you 1–2 DNS records to add wherever your domain is registered. Once added, it can take a few hours to propagate.

## File structure

```
curatedwhips-site/
  index.html          Home
  services.html        Pricing & service comparison
  about.html            Jhoda's bio
  testimonials.html     Client reviews
  contact.html           Calendly embed + direct contact info
  css/style.css          All styling — one file, easy to tweak
  js/main.js             Mobile nav toggle only
  images/jhoda-edquist.jpg   Headshot used on the About page
```

## Making text edits later

Every page is plain HTML — open the file, find the text between tags, edit, save, and re-upload to GitHub (Vercel redeploys automatically on every push). No visual editor, but also no proprietary lock-in — these files work on any host.
