import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { executeDeployment } from './executor';
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

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

app.post('/api/container/toggle', async (req, res) => {
    const { environmentId, action } = req.body;
    
    if (!environmentId || !['start', 'stop'].includes(action)) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }

    const containerName = `env-${environmentId}`;

    try {
        console.log(`\n[🛑 LIFECYCLE] Executing '${action}' on container ${containerName}`);
        await execAsync(`docker ${action} ${containerName}`);
        
        console.log(`[✅ SUCCESS] Container ${containerName} is now ${action}ed.`);
        return res.status(200).json({ message: `Container successfully ${action}ed.` });
    } catch (error: any) {
        console.error(`[❌ FAILED] Failed to ${action} container:`, error.message);
        return res.status(500).json({ error: error.message });
    }
});

app.delete('/api/environment/:id', async (req, res) => {
    const environmentId = req.params.id;
    const containerName = `env-${environmentId}`;
    const imageName = `env-${environmentId}:latest`;

    try {
        console.log(`\n[🗑️ TEARDOWN] Initiating destruction for Environment: ${environmentId}`);

        try {
            await execAsync(`docker rm -f ${containerName}`);
            console.log(`      -> Container ${containerName} destroyed.`);
        } catch (e) {
            console.log(`      -> Container ${containerName} not found. Skipping.`);
        }

        try {
            await execAsync(`docker rmi -f ${imageName}`);
            console.log(`      -> Image ${imageName} destroyed.`);
        } catch (e) {
            console.log(`      -> Image ${imageName} not found. Skipping.`);
        }

        console.log(`[✅ SUCCESS] Infrastructure for ${environmentId} completely wiped.`);
        return res.status(200).json({ message: 'Infrastructure cleanly destroyed.' });
    } catch (error: any) {
        console.error(`[❌ FAILED] Teardown error:`, error.message);
        return res.status(500).json({ error: 'Internal agent error during teardown.' });
    }
});