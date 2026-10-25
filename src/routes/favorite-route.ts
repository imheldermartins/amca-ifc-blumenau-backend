import { ApplicationRouter } from '@/routes/application-router';
import middleware from '@/services/auth/middleware';
import favorites from '@/controllers/page-favorite-controller';

export class FavoriteRouter extends ApplicationRouter {
  constructor() { super(middleware.handle); }
  protected registerRoutes(): void {
    /** @openapi
     * /favorites/pages:
     *   get:
     *     summary: List readable pages favorited by the authenticated user
     *     responses:
     *       200:
     *         description: Personal paginated favorites
     */
    this.router.get('/pages', async (req, res) => { const result = await favorites.list(req.userId as string, req.query); return res.status(result.status).json(result.data); });
    this.router.get('/pages/:pageId', async (req, res) => { const result = await favorites.state(req.userId as string, req.params.pageId as string); return res.status(result.status).json(result.data); });
    this.router.put('/pages/:pageId', async (req, res) => { const result = await favorites.set(req.userId as string, req.params.pageId as string, true); return res.status(result.status).json(result.data); });
    this.router.delete('/pages/:pageId', async (req, res) => { const result = await favorites.set(req.userId as string, req.params.pageId as string, false); return res.status(result.status).json(result.data); });
  }
}
export default new FavoriteRouter().build();
