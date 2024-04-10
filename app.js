const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const app = express()
app.use(express.json())
const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const initialzationDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server is Running http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error ${e.message}`)
    process.exit(1)
  }
}
initialzationDBAndServer()

//AUTHENTICATION TOKEN

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  }
}

//LOGIN ACCESS VERIFICATION
const accessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getAccessQuery = `
    SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id = "${tweetId}" AND  follower_user_id = "${userId}";`
  const tweet = await db.get(getAccessQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//USER FOLLOWING ID'S
const getFollowingPeopleIdsOfUser = async username => {
  const getFollowingPeopleQuery = `
  SELECT following_user_id FROM follower
  INNER JOIN user ON user.user_id = follower.follower_user_id
  WHERE user.username = "${username}";`

  const followingPeople = await db.all(getFollowingPeopleQuery)
  const ids = followingPeople.map(eachUser => eachUser.following_user_id)
  return ids
}

//API 1 register
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const selectUserDetails = `SELECT * FROM user WHERE username = "${username}";`
  const userDetails = await db.get(selectUserDetails)

  if (userDetails !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createUserQuery = `INSERT INTO user(username,password,name,gender)
            VALUES("${username}","${hashedPassword}","${name}","${gender}")`
      await db.run(createUserQuery)
      response.send('User created successfully')
    }
  }
})

// API 2 login

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
        userId: dbUser.user_id,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// API 3 /user/tweets/feed/

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username)
  const getTweetQuery = `SELECT username, tweet, date_time AS dateTime FROM user INNER JOIN tweet ON 
  user.user_id = tweet.user_id WHERE user.user_id IN (${followingPeopleIds})
  ORDER BY date_time DESC 
  LIMIT 4;`
  const tweets = await db.all(getTweetQuery)
  response.send(tweets)
})

//API 4
app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username, userId} = request
  const getfollowingQuery = `
  SELECT name FROM follower INNER JOIN user ON user.user_id = follower.following_user_id
  WHERE follower_user_id = "${userId}";`
  const followers = await db.all(getfollowingQuery)
  response.send(followers)
})

//API 5

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username, userId} = request
  const getfollowerQuery = `
  SELECT DISTINCT name FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id
  WHERE following_user_id = "${userId}";`
  const followers = await db.all(getfollowerQuery)
  response.send(followers)
})

//API 6
app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  accessVerification,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const getTweetQuery = `
      SELECT tweet,
      (SELECT COUNT(like_id) FROM likes WHERE tweet_id = "${tweetId}") AS likes,
      (SELECT COUNT(replay_id) FROM reply WHERE tweet_id = "${tweetId}") AS replies,
      date_time AS dateTime
      FROM tweet WHERE tweet_id = "${tweetId}";`
    const tweet = await db.get(getTweetQuery)
    response.send(tweet)
  },
)

//API 7
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  accessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getQuery = `
  SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id
  WHERE tweet_id = "${tweetId}"`
    const likeedUser = await db.all(getQuery)
    const user = likeedUser.map(eachUser => eachUser.username)
    response.send({likes: user})
  },
)

//API 8
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  accessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getReplyQuery = `
  SELECT name,reply FROM user INNER JOIN reply ON user.user_id = reply.user_id
  WHERE tweet_id = "${tweetId}"`
    const replayUser = await db.all(getReplyQuery)
    response.send({replies: replayUser})
  },
)

// API 9
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {userId} = request
  const getTweetQuery = `
  SELECT tweet,
  COUNT(DISTINCT like_id) AS likes,
  COUNT(DISTINCT reply_id) AS replies,
  date_time AS dateTime 
  FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
  LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  WHERE tweet.user_id = ${userId}
  GROUP BY tweet.tweet_id; `
  const tweets = await db.all(getTweetQuery)
  response.send(tweets)
})

//API 10
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('!', ' ')
  const createTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time)
  VALUES ("${tweet}","${userId}","${dateTime}")`
  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

//API 11

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    const getTheQuery = `
  SELECT * FROM tweet WHERE user_id = "${userId}" AND tweet_id = "${tweetId}"`
    const tweet = await db.get(getTheQuery)

    if (tweet === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteQuery = `DELETE FROM tweet WHERE tweet_id = "${tweetId}"`
      await db.run(deleteQuery)
      response.send('Tweet Removed')
    }
  },
)

module.exports = app
