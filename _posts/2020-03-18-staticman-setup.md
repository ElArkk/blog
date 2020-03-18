---
layout: post
title: "Setting up Staticman for static comments"
date: 2020-03-18
categories: Python, Node.js, Heroku
---

Yesterday, I _finally_ got comments to work on this blog using
[Staticman][staticman]. Staticman is small `Node.js` app that you can send
`POST` request to from your comment form. Staticman will then upload the comment
as a file to the dedicated spot in your blog repository on GitHub (or GitLab).
If you turn on moderation, it will create a pull request instead. To do this, it
of course needs push rights to your repo, and setting up everything correctly,
including running your own instance of Staticman, turned out to be a bit more
difficult than it initially seemed.

First, you need to choose which endpoint of staticman you want to use. `v1`
(deprecated), `v2` or `v3`. For quite a while I was trying to use the newest
(`v3`) endpoint of Staticman, with no success. Turns out, that `v3` does not
support authentication through Personal Accesss Tokens anymore, but only through
GitHub applications (I found out [here][staticmanissue]). When I made the switch
to `v2`, things started to work out.

I am hosting my own instance of staticman on the free tier of [Heroku][heroku].
Two sources that really helped me doing so can be found [here][herokusetuptam]
and [here][herokusetupyasoob].

On the blog side, a `staticman.yml` file is required, and a `POST` request to
the right address in the comment form. Have a look at my [Staticman
repo][staticman-elarkk], and at the`staticman.yml`, `_includes/comments-v2.html`
and `_layouts/post.html` files in my [blog repo][blog] to see a working setup.

The next steps will be to make the comment form prettier, implement nested
comments, get spam protection through [Akismet][akismet] and set up comment
notifications using [Mailgun][mailgun].

If you have any questions or comments, feel free to leave a static comment, man!

<!-- prettier-ignore-start -->
[staticman]: https://github.com/eduardoboucas/staticman
[heroku]: https://heroku.com/
[herokusetuptam]: https://vincenttam.gitlab.io/post/2018-09-16-staticman-powered-gitlab-pages/2/
[herokusetupyasoob]: https://yasoob.me/posts/running_staticman_on_static_hugo_blog_with_nested_comments/
[staticmanissue]: https://github.com/eduardoboucas/staticman/issues/332#issuecomment-594294808
[blog]: https://github.com/ElArkk/blog
[staticman-elarkk]: https://github.com/ElArkk/staticman-elarkk
[akismet]: https://akismet.com/
[mailgun]: https://www.mailgun.com/
<!-- prettier-ignore-end -->
