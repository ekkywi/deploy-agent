import { BaseStackStrategy } from "./base.interface";

export class NextJsStackStrategy implements BaseStackStrategy {
    async generateDockerfile(workDir: string): Promise<string> {
        return `
FROM node:22-apline
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
        `.trim();
    }
}