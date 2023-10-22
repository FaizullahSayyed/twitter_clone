const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const nodemon = require("nodemon");
const JWT = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("DB & Server started.");
    });
  } catch (error) {
    console.log("Connection failed");
  }
};

initializeDBAndServer();

const authenticator = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[0];
  }
  if (jwtToken === undefined) {
    response.status(401).send("Invalid JWT Token");
  } else {
    JWT.verify(jwtToken, "secret_string", async (error, payload) => {
      if (error) {
        response.status(401).send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        const { name, user_id } = await db.get(
          `SElECT * FROM user WHERE username = '${payload.username}';`
        );
        request.name = name;
        request.user_id = user_id;
        next();
      }
    });
  }
};

const checkFollowing = async (obj) => {
  const twittedUser = await db.get(`
        SELECT
            user_id
        FROM
            tweet
        WHERE
            tweet_id = ${obj.params.tweetId};
    `);
  const followings = await db.all(`
        SELECT
            following_user_id
        FROM
            follower INNER JOIN user ON follower.follower_user_id = user.user_id
        WHERE
            username = '${obj.username}';
  `);
  const isFollower = followings.some(
    (obj) => obj.following_user_id === twittedUser.user_id
  );
  if (isFollower) {
    return true;
  } else {
    return false;
  }
};

//API 1
// app.post("/register/", async (request, response) => {
//   const { username, password, name, gender } = request.body;
//   const user = await db.get(`
//         SELECT
//             username
//         FROM
//             user
//         WHERE
//             username = '${username}';
//     `);
//   if (user === undefined) {
//     if (password && password.length > 6) {
//       const hashedPassword = await bcrypt.hash(request.body.password, 10);
//       console.log(hashedPassword);
//       await db.run(`
//         INSERT INTO
//             user
//         (name, username, password, gender)
//         VALUES
//         (
//             '${name}',
//             '${username}',
//             '${hashedPassword}',
//             '${gender}'
//         )
//       `);
//       response.send("User created successfully");
//     } else {
//       response.status(400).send("Password is too short");
//     }
//   } else {
//     response.status(400).send("User already exists");
//   }
// });

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const user = await db.get(`
    SELECT 
        username
    FROM
        user
    WHERE
        username = '${username}';
  `);
  if (user === undefined) {
    if (password && password.length > 6) {
      // Check if password is defined and has a length > 6
      const hashedPassword = await bcrypt.hash(request.body.password, 10);
      console.log(hashedPassword);
      await db.run(`
        INSERT INTO
            user
        (name, username, password, gender)
        VALUES
        (
            '${name}',
            '${username}',
            '${hashedPassword}',
            '${gender}'
        )
      `);
      response.send("User created successfully");
    } else {
      response.status(400).send("Password is too short");
    }
  } else {
    response.status(400).send("User already exists");
  }
});

//API 2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const user = await db.get(`
        SELECT
            username, password
        FROM
            user
        WHERE
            username = '${username}'
    `);
  if (user === undefined) {
    response.status(400).send("Invalid user");
  } else {
    if (await bcrypt.compare(password, user.password)) {
      const jwtToken = JWT.sign({ username: username }, "secret_string");
      response.send({ jwtToken });
    } else {
      response.status(400).send("Invalid password");
    }
  }
});

//API 3
app.get("/user/tweets/feed/", authenticator, async (request, response) => {
  const { username, user_id } = request;
  const followings = await db.all(
    `
      SELECT following_user_id
      FROM follower
      WHERE follower_user_id = ?;
    `,
    [user_id]
  );

  if (followings.length === 0) {
    return response.status(404).json({ error: "No following users found." });
  }

  const following_user_ids = followings
    .map((obj) => obj.following_user_id)
    .join(",");

  const tweets = await db.all(`
      SELECT user.username as username, tweet.tweet as tweet, tweet.date_time as dateTime  
      FROM user
      INNER JOIN tweet ON user.user_id = tweet.user_id
      WHERE tweet.user_id IN (${following_user_ids})
      GROUP BY tweet.tweet_id
      ORDER BY dateTime DESC
      LIMIT 4;
    `);

  response.json(tweets);
});

//API 4
app.get("/user/following/", authenticator, async (request, response) => {
  const { username, user_id } = request;
  const follows = await db.all(`
    SELECT
        following_user_id
    FROM
        follower
    WHERE
        follower_user_id = ${user_id};
  `);
  let followsIds = [];
  for (const obj of follows) {
    followsIds.push(obj.following_user_id);
  }
  response.send(
    await db.all(`
            SELECT
                name
            FROM
                user
            WHERE
                user_id IN (${followsIds.join(",")});
        `)
  );
});

//API 5
app.get("/user/followers/", authenticator, async (request, response) => {
  const { username, user_id } = request;
  response.send(
    await db.all(`
            SELECT
                user.name as name
            FROM
                user INNER JOIN follower ON follower.follower_user_id = user.user_id
            WHERE
                following_user_id = ${user_id};
        `)
  );
});

//API 6
app.get("/tweets/:tweetId/", authenticator, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;

  const tweet = await db.get(`
    SELECT
    tweet.user_id, 
    tweet.tweet, 
    (SELECT COUNT(like_id) FROM like WHERE like.tweet_id = tweet.tweet_id) as likes, 
    (SELECT COUNT(reply_id) FROM reply WHERE reply.tweet_id = tweet.tweet_id) as replies, 
    tweet.date_time as dateTime
FROM
    tweet
WHERE
    tweet.tweet_id = ${tweetId};

  `);

  if (checkFollowing(request)) {
    response.send({
      tweet: tweet.tweet,
      likes: tweet.likes,
      replies: tweet.replies,
      dateTime: tweet.dateTime,
    });
  } else {
    response.status(401).send("Invalid Request");
  }
});

//API 7
app.get("/tweets/:tweetId/likes/", authenticator, async (request, response) => {
  const { tweetId } = request.params;
  const { username, user_id } = request;
  const likedUsersIdArray = [];
  if (checkFollowing(request)) {
    const likedUsersId = await db.all(
      `
            SELECT
                user_id
            FROM
                like
            WHERE
                tweet_id = ${tweetId};
          `
    );
    likedUsersId.map((obj) => likedUsersIdArray.push(obj.user_id));
    const likedUserName = await db.all(`
        SELECT
            username
        FROM
            user
        WHERE
            user_id IN(${likedUsersIdArray.join(",")});
    `);
    const likedUsersArray = { likes: [] };
    for (const i of likedUserName) {
      likedUsersArray.likes.push(i.username);
    }

    response.send(likedUsersArray);
  } else {
    response.status(401).send("Invalid Request");
  }
});

//API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticator,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    if (checkFollowing(request)) {
      const replies = await db.all(`
        SELECT
            name,
            reply
        FROM
            user INNER JOIN reply ON reply.user_id = user.user_id
                INNER JOIN tweet ON tweet.user_id = reply.tweet_id
        WHERE
            tweet.tweet_id = ${tweetId};
    `);
      response.send({ replies: replies });
    } else {
      response.status(401).send("Invalid Request");
    }
  }
);

//API 9
app.get("/user/tweets/", authenticator, async (request, response) => {
  const { username, user_id } = request;
  response.send(
    await db.all(`
        SELECT
            tweet.tweet,
            (SELECT COUNT(like_id) FROM like WHERE like.tweet_id = tweet.tweet_id) as likes,
            (SELECT COUNT(reply_id) FROM reply WHERE reply.tweet_id = tweet.tweet_id) as replies,
            tweet.date_time as dateTime
        FROM
            tweet
        WHERE
            tweet.user_id = ${user_id}
        ORDER BY dateTime DESC    
        ;
    `)
  );
});

//API 10
app.post("/user/tweets/", authenticator, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const user = await db.get(
    `SELECT user_id FROM user WHERE username = '${username}';`
  );
  await db.run(`
      INSERT INTO
          tweet (tweet, user_id)
      VALUES
          (
              '${tweet}',
              ${user.user_id}
          );
    `);
  response.send("Created a Tweet");
});

//API 11
app.delete("/tweets/:tweetId/", authenticator, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const tweetedUser = await db.get(
    `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId}`
  );
  const user = await db.get(
    `SELECT user_id FROM user WHERE username = '${username}';`
  );
  if (tweetedUser.user_id === user.user_id) {
    await db.run(`
      DELETE FROM
          tweet
      WHERE
          tweet_id = ${tweetId};
  `);
    response.send("Tweet Removed");
  } else {
    response.status(401).send("Invalid Request");
  }
});
module.exports = app;
