import { BaseStackStrategy } from "./base.interface";

export class NextJsStackStrategy implements BaseStackStrategy {
    async generateDockerfile(workDir: string, nodeVersion: string = '22'): Promise<string> {
    return `FROM node:${nodeVersion}-alpine
            WORKDIR /app
            COPY package*.json ./
            RUN npm ci
            COPY . .
            RUN npm run build
            EXPOSE 3000
            CMD ["npm", "start"]`;
    }
}