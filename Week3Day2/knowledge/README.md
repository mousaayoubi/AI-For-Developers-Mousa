# Project Overview

This project is a Document Q&A Assistant built as a learning exercise for
Retrieval-Augmented Generation (RAG). It demonstrates how to combine a local
knowledge base with a local large language model to answer questions grounded
in project documentation.

## Purpose

The assistant helps new team members quickly find answers about how the
project is built, tested, and secured, without having to search through every
file in the repository.

## Tech Stack Summary

The project is a full-stack JavaScript application. The backend is written in
Node.js and Express, and the frontend is built with vanilla HTML, CSS, and
JavaScript (no frontend framework is used). Data is persisted in PostgreSQL.

## Automated Testing

The project includes automated testing during development. Tests are run
locally and in continuous integration before code is merged. See testing.md
for full details on the testing strategy.

## Getting Started

1. Clone the repository.
2. Copy `.env.example` to `.env` and fill in the required values.
3. Run `npm install` to install dependencies.
4. Run `npm run dev` to start the development server.

## Deployment

The application is containerized with Docker. Deployment configuration and
target infrastructure are managed separately by the DevOps team and are not
documented in this knowledge base.

## Contributing

Please read architecture.md, testing.md, and security.md before submitting a
Pull Request. All contributions must follow the project's Controller,
Service, and Repository pattern and must include appropriate tests.
