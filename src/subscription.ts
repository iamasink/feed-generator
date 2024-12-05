import { TimeLike } from 'node:fs'
import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import https from "node:https"

export interface Cache {
  accept: boolean
  time: number
}

const cacheObject: Record<string, Cache> = {}

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    // This logs the text of every post off the firehose.
    // Just for fun :)
    // Delete before actually using
    for (const post of ops.posts.creates) {
      // console.log(post.record)
    }

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    const postsToCreate = ops.posts.creates
      .filter((create) => {
        // Remove replies
        if (create.record.reply) {
          // console.log(`[SKIP] Post is a reply: ${create.uri}`)
          return false
        }

        // Ignore posts not created in the last day
        if (Date.parse(create.record.createdAt) < Date.now() - 86400000) {
          // console.log(`[SKIP] Post is older than 1 day: ${create.uri}`)
          return false
        }

        const authorDid = create.author
        const cachedData = cacheObject[authorDid]

        if (cachedData) {
          console.log(`[📋] Found cache for author ${authorDid}:`, cachedData)
          if (cachedData.accept) {
            console.log(`[✅📋] User added from cache: ${authorDid}`)
            return true
          } else {
            // console.log(`[DENY] User denied from cache: ${authorDid}`)
            return false
          }
        }

        // console.log(`[FETCH] Fetching info for user: ${authorDid}`)
        https.get(`https://plc.directory/${authorDid}`, (res) => {
          if (res.statusCode != 200) {
            console.log(`[HTTP] Response received for ${authorDid}. Status: ${res.statusCode}`)
          }

          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })

          res.on('end', () => {
            try {
              const userinfo = JSON.parse(data)
              const useraka = userinfo.alsoKnownAs as string[]

              if (!useraka || useraka.length === 0) {
                console.log(`[❌] User has no "alsoKnownAs" field: ${authorDid}`)
                cacheObject[authorDid] = { accept: false, time: Date.now() }
                return false
              }

              if (!useraka[0].endsWith('.bsky.social') && !useraka[0].endsWith('.brid.gy')) {
                console.log(`[✅] User added: ${authorDid}, AKA: ${useraka}`)
                cacheObject[authorDid] = { accept: true, time: Date.now() }
                return true
              } else {
                // console.log(`[DENY] User denied: ${authorDid}, AKA: ${useraka}`)
                cacheObject[authorDid] = { accept: false, time: Date.now() }
                return false
              }
            } catch (err) {
              console.error(`[❗❗] Failed to parse user info for ${authorDid}:`, err)
              return false
            }
          })
        }).on('error', (err) => {
          console.error(`[❗❗] HTTP request failed for ${authorDid}:`, err)
        })


      })
      .map((create) => {
        return {
          uri: create.uri,
          cid: create.cid,
          indexedAt: new Date().toISOString(),
        }
      })

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }
    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }
}
