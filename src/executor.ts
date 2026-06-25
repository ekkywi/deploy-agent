import { exec, spawn } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { StackFactory } from './stacks/stack.factory';

const execAsync = util.promisify(exec);

type DeploymentEnvVar = {
    key: string;
    value: string;
};

type DeploymentPayload = {
    deploymentId: string;
    environmentId: string;
    repoUrl: string;
    stackType: string;
    nodeVersion?: string;
    environmentName: string;
    branch: string;
    targetPort: number;
    envVars?: DeploymentEnvVar[];
};

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

function runCommandRealtime(command: string, workDir: string, logFilePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, { cwd: workDir, shell: true });

        proc.stdout.on('data', (data: Buffer) => {
            fs.appendFileSync(logFilePath, data.toString());
        });

        proc.stderr.on('data', (data: Buffer) => {
            fs.appendFileSync(logFilePath, data.toString());
        });

        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command exited with code ${code}`));
        });
    });
}

export async function executeDeployment(payload: DeploymentPayload) {
    const { deploymentId, environmentId, repoUrl, stackType, nodeVersion, environmentName, branch, targetPort } = payload;
    
    const workDir = path.join(process.cwd(), 'workspaces', deploymentId);
    const logsDir = path.join(process.cwd(), 'logs');
    const logFilePath = path.join(logsDir, `${deploymentId}.log`);
    const containerName = `env-${environmentId}`; 
    const imageName = `env-${environmentId}:latest`;

    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    const writeLog = (message: string) => {
        console.log(message);
        fs.appendFileSync(logFilePath, `${message}\n`);
    };

    try {
        writeLog(`\n[⚙️ EXECUTION] Starting job for ${deploymentId}`);
        writeLog(`[🎯 TARGET] Environment: ${environmentName} | Branch: ${branch} | Port: ${targetPort}`);
        writeLog(`----------------------------------------------------------------------`);

        writeLog(`[1/5] Cloning repository: ${repoUrl} (Branch: ${branch})`);
        await runCommandRealtime(`git clone -b ${branch} --single-branch ${repoUrl} .`, workDir, logFilePath);

        writeLog(`\n[2/5] Injecting Environment Variables...`);
        if (payload.envVars && payload.envVars.length > 0) {
            const envContent = payload.envVars.map((envVar) => `${envVar.key}=${envVar.value}`).join('\n');
            fs.writeFileSync(path.join(workDir, '.env'), envContent);
            writeLog(`      -> Injected ${payload.envVars.length} variables into .env file.`);
        } else {
            writeLog(`      -> No environment variables provided.`);
        }

        const dockerfilePath = path.join(workDir, 'Dockerfile');
        
        const stackStrategy = StackFactory.getStrategy(stackType);

        if (!fs.existsSync(dockerfilePath)) {
            writeLog(`\n[3/5] No Dockerfile found. Resolving build strategy for ${stackType}...`);
            
            if (stackStrategy.preBuildHook) {
                writeLog(`      -> Executing pre-build hooks for ${stackType}...`);
                await stackStrategy.preBuildHook(workDir, logFilePath);
            }

            const dockerfileContent = await stackStrategy.generateDockerfile(workDir, nodeVersion);
            fs.writeFileSync(dockerfilePath, dockerfileContent);
            
            writeLog(`      -> Auto-generated Dockerfile injected successfully.`);
        } else {
            writeLog(`\n[3/5] Existing Dockerfile detected in repository. Bypassing auto-generation.`);
        }

        writeLog(`\n[4/5] Building Docker Image (${imageName})...`);
        await runCommandRealtime(`docker build --network=host -t ${imageName} .`, workDir, logFilePath);

        writeLog(`\n[5/5] Starting Container...`);
        try {
            writeLog(`      -> Terminating old container instance if exists...`);
            await runCommandRealtime(`docker rm -f ${containerName}`, workDir, logFilePath);
        } catch (e) {
        }

        writeLog(`      -> Booting new container on port ${targetPort}...`);
        await runCommandRealtime(`docker run -d -p ${targetPort}:3000 --name ${containerName} ${imageName}`, workDir, logFilePath);
        
        writeLog(`\n[✅ SUCCESS] Container is running on Port: ${targetPort}`);
        writeLog(`----------------------------------------------------------------------`);
        await reportToControlPlane(deploymentId, 'SUCCESS', targetPort, 'Container deployed successfully.');

    } catch (error: unknown) {
        const message = getErrorMessage(error);
        writeLog(`\n[❌ FAILED] Deployment error: ${message}`);
        writeLog(`----------------------------------------------------------------------`);
        await reportToControlPlane(deploymentId, 'FAILED', null, message);
    } finally {
        writeLog(`\n[🧹 CLEANUP] Removing temporary workspace and dangling images...`);
        
        if (fs.existsSync(workDir)) {
            fs.rmSync(workDir, { recursive: true, force: true });
        }
        
        try {
            await execAsync(`docker image prune -f`);
            writeLog(`[🧹 CLEANUP] Unused images pruned successfully.`);
        } catch {
            writeLog(`[⚠️ CLEANUP WARNING] Failed to prune unused images.`);
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
    } catch (err: unknown) {
        console.error(`[⚠️ CALLBACK ERROR] Failed to report to Control Plane: ${getErrorMessage(err)}`);
    }
}
