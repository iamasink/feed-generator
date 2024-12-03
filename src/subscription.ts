import { TimeLike } from 'node:fs'
import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import https from "node:https"

export interface cache {
  did: string
  name: string
  time: number
}


const usercache: cache[] = []

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
        // only alf-related posts
        // console.log(create)
        const authorDid = create.author

        const cacheddata = usercache.find(e => e.did == authorDid)

        if (cacheddata) {
          if (!cacheddata.name.endsWith(".bsky.social")) {
            console.log("user added from cache", cacheddata)
            return true
          } else {
            return false
          }
        }
        https.get("https://plc.directory/" + authorDid, (res) => {
          // console.log('statusCode:', res.statusCode)
          // console.log('headers:', res.headers)

          res.on('data', (d) => {
            const userinfo = JSON.parse(d)
            const useraka = (userinfo.alsoKnownAs as Array<string>)
            usercache.push({ name: useraka[0], did: authorDid, time: Date.now() })
            if (!useraka) return
            if (!useraka[0].endsWith(".bsky.social")) {
              console.log("user added", useraka)
              return true
            }
          })
          // console.log(res)
          // const authoraka = res["alsoKnownAs"]
          // console.log(authoraka)


        }

      })
      .map((create) => {
        // map alf-related posts to a db row
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
