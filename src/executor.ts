import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = util.promisify(exec);

export async function executeDeployment(payload: any) {
    const { deploymentId, environmentId, repoUrl, stackType, environmentName, branch, targetPort } = payload;
    const workDir = path.join(process.cwd(), 'workspaces', deploymentId);
    const containerName = `env-${environmentId}`; 
    const imageName = `env-${environmentId}:latest`;

    try {
        console.log(`\n[⚙️ EXECUTION] Starting job for ${deploymentId}`);
        console.log(`[🎯 TARGET] Environment: ${environmentName} | Branch: ${branch} | Port: ${targetPort}`);
        
        if (!fs.existsSync(workDir)) {
            fs.mkdirSync(workDir, { recursive: true });
        }

        console.log(`[1/5] Cloning repository: ${repoUrl} (Branch: ${branch})`);
        await execAsync(`git clone -b ${branch} --single-branch ${repoUrl} .`, { cwd: workDir });

        console.log(`[2/5] Injecting Environment Variables...`);
        if (payload.envVars && payload.envVars.length > 0) {
            const envContent = payload.envVars.map((e: any) => `${e.key}=${e.value}`).join('\n');
            fs.writeFileSync(path.join(workDir, '.env'), envContent);
            console.log(`      -> Injected ${payload.envVars.length} variables into .env file.`);
        } else {
            console.log(`      -> No environment variables provided.`);
        }

        const dockerfilePath = path.join(workDir, 'Dockerfile');
        if (!fs.existsSync(dockerfilePath)) {
            console.log(`[3/5] No Dockerfile found. Generating default for ${stackType}...`);
            if (stackType === 'NEXTJS') {
                fs.writeFileSync(dockerfilePath, `
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
                `.trim());
            } else {
                throw new Error(`Auto-generation for stack ${stackType} is not supported yet.`);
            }
        }

        console.log(`[4/5] Building Docker Image (${imageName})...`);
        await execAsync(`docker build --network=host -t ${imageName} .`, { cwd: workDir });

        console.log(`[5/5] Starting Container...`);
        
        try {
            console.log(`      -> Terminating old container instance if exists...`);
            await execAsync(`docker rm -f ${containerName}`);
        } catch (e) {
        }

        console.log(`      -> Booting new container on port ${targetPort}...`);
        await execAsync(`docker run -d -p ${targetPort}:3000 --name ${containerName} ${imageName}`);
        
        console.log(`[✅ SUCCESS] Container is running on Port: ${targetPort}`);
        await reportToControlPlane(deploymentId, 'SUCCESS', targetPort, 'Container deployed successfully.');

    } catch (error: any) {
        console.error(`\n[❌ FAILED] Deployment error:`, error.message);
        await reportToControlPlane(deploymentId, 'FAILED', null, error.message);
    } finally {
        console.log(`[🧹 CLEANUP] Removing temporary workspace and dangling images...`);
        
        if (fs.existsSync(workDir)) {
            fs.rmSync(workDir, { recursive: true, force: true });
        }
        
        try {
            await execAsync(`docker image prune -f`);
        } catch (e) {
            console.error(`[⚠️ CLEANUP WARNING] Failed to prune unused images.`);
        }
    }
}

async function reportToControlPlane(deploymentId: string, status: string, port: number | null, message: string) {
    const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL;
    const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN;

    if (!CONTROL_PLANE_URL) return;

    try {
        const response = await fetch(`${CONTROL_PLANE_URL}/api/webhooks/agent/deploy-status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AUTH_TOKEN}`
            },
            body: JSON.stringify({ deploymentId, status, port, message })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status} - ${errorText}`);
        }

        console.log(`[📡 CALLBACK] Status '${status}' successfully reported to Control Plane.`);
    } catch (err: any) {
        console.error(`[⚠️ CALLBACK ERROR] Failed to report to Control Plane: ${err.message}`);
    }
}