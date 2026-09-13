import { Router, type Request, type Response } from 'express';
import inviteController from '@controllers/invite-controller';
import middleware from '@core/auth/middleware';
import { StatusCode } from '@core/http/status-code';

const router = Router();

router.get('/:token', async (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  return res.status(StatusCode.OK).json(await inviteController.preview(req.params.token));
});

router.post('/:token/accept', middleware.handle, async (req: Request, res: Response) => {
  const accepted = await inviteController.accept(req.params.token, req.userId as string);
  return accepted
    ? res.status(StatusCode.OK).json({ accepted: true })
    : res.status(StatusCode.CONFLICT).json({ message: 'O convite não pode mais ser aceito.' });
});

export default router;
