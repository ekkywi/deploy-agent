import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { executeDeployment } from './executor';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN;

if (!AUTH_TOKEN) {
    console.error("FATAL ERROR: AGENT_AUTH_TOKEN is not defined in .env file");
    process.exit(1);
}

app.use(cors());
app.use(express.json());

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader?.startsWith('Bearer ')) {
        res.status(401).json(
            { error: 'Unauthorized: Missing or invalid token format.'}
        );
        return;
    }

    const token = authHeader.split(' ')[1];

    if (token !== AUTH_TOKEN) {
        res.status(403).json(
            { error: 'Forbidden: Invalid agent token.' }
        );
        return;
    }

    next();
};

app.post('/api/deploy', requireAuth, (req: Request, res: Response) => {
    const payload = req.body;

    if (!payload.deploymentId || !payload.repoUrl || !payload.stackType) {
        res.status(400).json(
            { error: 'Bad Request: Missing required deployment payload fields.' }
        );
        return;
    }

    console.log(`\n[📥 INCOMING] Deployment request received.`);
    console.log(`- Deployment ID: ${payload.deploymentId}`);
    console.log(`- Environment  : ${payload.environmentName}`);
    console.log(`- Stack        : ${payload.stackType}`);
    console.log(`- Repository   : ${payload.repoUrl}`);

    res.status(200).json({ 
        message: 'Agent acknowledged. Deployment queued for execution.',
        deploymentId: payload.deploymentId 
    });

    executeDeployment(payload);
});

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`\n======================================`);
    console.log(`🚀 Docker Agent Runner is active`);
    console.log(`📡 Listening on http://0.0.0.0:${PORT}`);
    console.log(`🛡️  Security token validation: ENABLED`);
    console.log(`======================================\n`);
});