import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { processRouter } from './routes/processRouter';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api', processRouter);

// Health check
app.get('/health', (_, res) => {
  res.status(200).json({ status: 'ok', service: 'processor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Processor service running on port ${PORT}`);
}); 