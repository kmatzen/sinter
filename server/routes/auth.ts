import { Router } from 'express';
import passport from 'passport';

const router = Router();

// Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (_req, res) => {
    const isDev = process.env.NODE_ENV !== 'production';
    res.redirect(isDev ? 'http://localhost:5173/app' : '/app');
  },
);

// GitHub OAuth
router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));
router.get('/github/callback',
  passport.authenticate('github', { failureRedirect: '/' }),
  (_req, res) => {
    const isDev = process.env.NODE_ENV !== 'production';
    res.redirect(isDev ? 'http://localhost:5173/app' : '/app');
  },
);

// Current user
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json(req.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.logout(() => {
    res.json({ ok: true });
  });
});

export default router;
