import fs from "fs";
import path from "path";
import { BaseStackStrategy } from "./base.interface";

export class NextJsStackStrategy implements BaseStackStrategy {
    async generateDockerfile(workDir: string, nodeVersion: string = '22'): Promise<string> {
        const packageJsonPath = path.join(workDir, "package.json");
        let needsPrismaGenerate = false;

        if (fs.existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
                const dependencies = {
                    ...(packageJson.dependencies ?? {}),
                    ...(packageJson.devDependencies ?? {}),
                };

                needsPrismaGenerate = Boolean(
                    dependencies.prisma || dependencies["@prisma/client"]
                );
            } catch {
                needsPrismaGenerate = false;
            }
        }

        const lines = [
            `FROM node:${nodeVersion}-alpine`,
            `WORKDIR /app`,
            `COPY package*.json ./`,
            `RUN npm ci`,
            `COPY . .`,
        ];

        if (needsPrismaGenerate) {
            lines.push(`RUN npx prisma generate`);
        }

        lines.push(
            `RUN npm run build`,
            `EXPOSE 3000`,
            `CMD ["npm", "start"]`
        );

        return lines.join("\n");
    }
}
