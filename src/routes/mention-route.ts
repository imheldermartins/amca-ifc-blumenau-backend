import { ApplicationRouter } from '@/routes/application-router';
import middleware from '@/services/auth/middleware';
import mentions from '@/controllers/mention-controller';

export class MentionRouter extends ApplicationRouter {
  constructor() { super(middleware.handle); }
  protected registerRoutes(): void {
    this.router.get('/', async (req, res) => {
      const result = await mentions.catalog(req.userId as string, req.query);
      return res.status(result.status).json(result.data);
    });
    this.router.post('/resolve', async (req, res) => {
      const result = await mentions.resolve(req.userId as string, req.body);
      return res.status(result.status).json(result.data);
    });
  }
}
export default new MentionRouter().build();
