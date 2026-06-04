# Inqom Brief Tool

Outil de brief de pages web pour Inqom — questionnaire guidé + génération IA + wireframe live.

## Stack
- HTML/JS statique servi par Vercel
- Vercel Edge Function pour le proxy API Anthropic

## Setup

### 1. Variables d'environnement Vercel
Dans le dashboard Vercel → Settings → Environment Variables :
```
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Deploy
```bash
git push origin main
```
Vercel déploie automatiquement.

## Structure
```
/
├── api/
│   └── chat.js          # Edge Function proxy → Anthropic API
├── public/
│   └── index.html       # L'outil complet
├── vercel.json          # Config rewrites
└── README.md
```
