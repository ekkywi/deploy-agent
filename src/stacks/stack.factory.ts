import { BaseStackStrategy } from './base.interface';
import { NextJsStackStrategy } from './nextjs.strategy';
import { LaravelStackStrategy } from './laravel.strategy';

export class StackFactory {
    private static strategies: Record<string, BaseStackStrategy> = {
        'NEXTJS': new NextJsStackStrategy(),
        'LARAVEL': new LaravelStackStrategy(),
    };

    public static getStrategy(stackType: string): BaseStackStrategy {
        const strategy = this.strategies[stackType.toUpperCase()];
        if (!strategy) {
            throw new Error(`Auto-generation for stack type '${stackType}' is not supported yet by this Agent.`);
        }
        return strategy;
    }
}