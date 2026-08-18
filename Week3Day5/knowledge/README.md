# Project Overview

This project is the AI Engineering Assistant built as the Week 03 capstone
exercise. It combines direct LLM answering, Retrieval-Augmented Generation
(RAG), and an MCP-backed repository agent into a single routed system.

## Purpose

The assistant answers three broad kinds of engineering questions: general
knowledge questions (answered directly by the LLM), project documentation
questions (answered using RAG over the `knowledge/` directory), and
repository investigation tasks (answered by an agent that uses tools to
inspect `sample-project/`).

## Tech Stack Summary

The project is a full-stack Vanilla JavaScript application. The backend is
written in Node.js and Express, and the frontend is built with vanilla HTML,
CSS, and JavaScript (no frontend framework is used). All LLM calls go
through a local Ollama server - no external AI API is used. Data is
persisted in PostgreSQL in the sample project the agent inspects.

## Automated Testing

The project includes an evaluation harness (`src/evaluation/`) instead of a
traditional test suite. It runs a fixed set of routing, RAG, agent, safety,
and general-question cases and produces a pass/fail summary. See
`testing.md` for details on the sample project's own testing approach.

## Getting Started

1. Install and start Ollama, then pull `llama3.1` and `nomic-embed-text`.
2. Run `npm install`.
3. Run `npm run index` to build the local RAG vector store.
4. Run `npm start` to start the web server.
5. Open `http://localhost:3000` and ask a question.

## Deployment

This project is a local learning exercise and is not deployed anywhere.
There is no production environment, hosting provider, or cloud region
associated with it.

## Contributing

Please read `architecture.md`, `testing.md`, and `security.md` before
changing the sample project. All contributions to the sample project must
follow its Controller, Service, and Repository pattern and must include
appropriate tests.
