import fs from 'fs';
import path from 'path';
import express from 'express';
import webpush from 'web-push';
import { logger } from './logger';
import { responseLogger } from './middlewares';
import {
  DATA_PATH,
  GCM_KEY,
  SUBJECT,
  VAPID_PUBLIC,
  VAPID_PRIVATE,
} from './constants';
import { Store, PushMessage } from './types';

// GCM_KEY (apikey ) 를 넣어서, 구글클라우드콘솔의 프로젝트에 pushapi를 쓸수있음
webpush.setGCMAPIKey(GCM_KEY);
// 필요한 정보들 세팅 ,( subject(?) ,공개키 ,비공개키)
webpush.setVapidDetails(
  SUBJECT,
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

const store: Store = { data: [] };

const app = express();

app.use('/', express.static(path.join(__dirname, '../../'))); // project root
app.use('/', express.static(path.join(__dirname, '../web'))); // project root/dist/web
app.use(responseLogger)
app.use(express.json());

app.get('/vapid-public-key', (_req, res) => {
  res.send(VAPID_PUBLIC);
});

app.post('/subscription', (req, res) => {
  const { userId, subscription } = req.body ?? {};

  // replace to new subscription if userId is already exist
  const index = store.data.findIndex((data) => data.userId === userId);
  if (~index) store.data[index].subscription = subscription;
  
  store.data.push({ userId, subscription });
  const data = JSON.stringify(store.data);

  fs.writeFile(DATA_PATH, data, 'utf-8', (error) => {
    if (error) {
      logger.error('POST /subscription', { error });
      res.status(500).end();
    } else {
      res.status(201).end();
    }
  });
});

app.delete('/subscription', (req, res) => {
  const { userId } = req.body ?? {};

  // remove target user data
  const index = store.data.findIndex((data) => data.userId === userId);
  if (~index) {
    store.data.splice(index, 1);
  }
  
  const data = JSON.stringify(store.data);

  fs.writeFile(DATA_PATH, data, 'utf-8', (error) => {
    if (error) {
      logger.error('DELETE /subscription', { error });
      res.status(500).end();
    } else {
      res.status(200).end();
    }
  });
});

app.post('/send-push-notification', (req, res) => {
  const { targetId: targetUserId, message } = req.body ?? {};
  logger.info(`Send push notification to '${targetUserId}' with '${message}'`);
  const targetUser = store
    .data
    .reverse()
    .find(({ userId }) => userId === targetUserId);

  if (targetUser) {
    const messageData: PushMessage = {
      title: 'Web Push | Getting Started',
      body: message || '(Empty message)',
    };

    // 구독정보, 메시지, (상단에 공개키,비공개키 ,api키 )를 구글 푸쉬서비스에 보냄
    webpush
      .sendNotification(targetUser.subscription, JSON.stringify(messageData))
      .then((pushServiceRes) => res.status(pushServiceRes.statusCode).end())
      .catch((error) => {
        logger.error('POST /send-push', { error });
        res.status(error?.statusCode ?? 500).end();
      });
  } else {
    res.status(404).end();
  }
});

new Promise<void>((resolve) => {
  fs.access(DATA_PATH, fs.constants.F_OK, (error) => {
    // create data file if not exist
    error && fs.writeFileSync(DATA_PATH, JSON.stringify([]), 'utf-8');
    resolve();
  });
}).then(() => {
  fs.readFile(DATA_PATH, (error, data) => {
    if (error) {
      logger.error('Cannot load data.json', { error });
    } else {
      store.data = JSON.parse(data.toString());
    }
    app.listen(8080, () => logger.info('Server started'));
  });
});
