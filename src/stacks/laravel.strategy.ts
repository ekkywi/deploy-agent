import { BaseStackStrategy } from './base.interface';

export class LaravelStackStrategy implements BaseStackStrategy {
    async generateDockerfile(workDir: string): Promise<string> {
        return `
FROM php:8.3-cli-alpine
RUN docker-php-ext-install pdo pdo_mysql
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
WORKDIR /app
COPY . .
RUN composer install --no-dev --optimize-autoloader
RUN php artisan config:cache
RUN php artisan route:cache
RUN php artisan view:cache
EXPOSE 8000
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
        `.trim();
    }
}