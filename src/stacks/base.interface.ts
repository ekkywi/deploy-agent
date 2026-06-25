export interface BaseStackStrategy {
    generateDockerfile(workDir: string, version?: string): Promise<string>;
    preBuildHook?(workDir: string, logFilePath: string): Promise<void>;
}
