# Book Extraction AI

This project is a monorepo built with Turborepo that extracts text from book covers using AI. It consists of two main services:

1. **Web Service**: Handles user uploads and displays results
2. **Processor Service**: Performs the actual AI processing of book images

This was built as a take-home assignment for Cal AI. Developed by Ajay Misra. 

## How It Works

1. User uploads an image of a book cover through the web interface
2. The web service stores the image and sends the URL to the processor service
3. The processor service validates if the image contains a book
4. If valid, the processor determines if the book is fiction or non-fiction
5. The processor extracts text from the first page (non-fiction) or second page (fiction)
6. The extracted text is returned to the web service and displayed to the user

## Prerequisites

- Node.js 18+ and npm
- OpenAI API key (for GPT-4 Vision)

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables:
   - Copy `.env.example` to `.env` in both `apps/web` and `apps/processor` directories
   - Add your OpenAI API key to `apps/processor/.env`

## Running the Services

### Development Mode

Run both services in development mode:

```
npm run dev
```

Or run each service individually:

```
# Web service
cd apps/web
npm run dev

# Processor service
cd apps/processor
npm run dev
```

### Production Mode

Build and run in production mode:

```
# Build all services
npm run build

# Start all services
npm run start
```

## Service URLs

- Web Service: http://localhost:3000
- Processor Service: http://localhost:3001

## Architecture

This project follows a monorepo structure using Turborepo with two main deployments:

1. **Web Service (Next.js)**
   - Handles user interface and file uploads
   - Communicates with the processor service

2. **Processor Service (Express)**
   - Validates book images using GPT-4 Vision
   - Determines book type (fiction/non-fiction)
   - Extracts text from appropriate pages

## Technologies Used

- Turborepo for monorepo management
- Next.js for the web frontend
- Express.js for the processor service
- TypeScript for type safety
- OpenAI GPT-4 Vision for image analysis and text extraction
# calai

## Vercel Deployment

For the Vercel deployment to work correctly, you need to set up the processor service separately, as Vercel's serverless functions cannot run persistent servers. 

Follow these steps:

1. Deploy the processor service to a platform that supports long-running Node.js applications:
   - Render
   - Railway
   - DigitalOcean
   - Heroku
   - AWS EC2
  
   - (Keep in mind, it should support serverless functions.) 

2. Once deployed, get the URL of your processor service.

3. In your Vercel project settings, add the following environment variables:
   ```
   PROCESSOR_API_URL=https://calai-web.vercel.app
   PROCESSOR_API_PATH=/api
   NEXT_PUBLIC_APP_URL=https://calai-web.vercel.app
   ```

4. Make sure your processor service has CORS configured to accept requests from your Vercel domain.

The issue with the current deployment is that the web app is trying to connect to a local processor service at http://localhost:3002, which doesn't exist in Vercel's serverless environment.
