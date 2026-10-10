# Feature Spec: 001 Telegram Ingestion Pipeline

## Goal
Build the Phase 1 Ingestion Pipeline that receives messages, documents, images, and URLs via Telegram, processes them using LangGraph, extracts metadata, stores raw files in Cloudflare R2, and indexes embeddings into Qdrant.

## User Stories
- As a user, I send a PDF/image/link to my Telegram bot.
- The bot extracts text (OCR for images, parsing for PDFs/URLs).
- The bot tags the item, creates Parent-Child chunks, uploads the original file to R2, and saves vectors to Qdrant.
- The bot confirms saving with a brief summary and extracted tags.