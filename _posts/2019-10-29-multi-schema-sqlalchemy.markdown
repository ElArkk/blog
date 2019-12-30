---
layout: post
title:  "Multi-schema Postgres database handling through SQLAlchemy"
date:   2019-10-29 22:13:11 +0100
categories: Python
---
![]({{site.baseurl}}/assets/img/chongching_bridge.png){:class="img-centered":height="200px" width="800px"}
*Chongching, China, 2013. &#9400; Arkadij Kummer*

[SQLAlchemy][sqlalchemy] is a great and mature database API for python. While reflecting a simple database through it's [ORM (object relational mapper)][orm] is quite straightforward, I found things to complicate a bit once I wanted to faithfully reflect a database with multiple schemas. Specifically, I had a Postgres database containing multiple schemas, which had in part tables with the same name. In the following I will go through the steps to

- represent a multischema Postgres db through use of the SQLAlchemy ORM,
- dynamically query tables with the same name in different schemas, and finally,
- implement the db migration tool alembic in a way that allows generating migrations on a per-schema basis.

For this, I will use a dummy example database containing two schemas (`Asia` and `Europe`).

#### Represent a multischema Postgres db through use of the SQLAlchemy ORM 

First, we need a place where to put all files dealing with reflecting our database. A common way is to have a `db` folder, and reflecting each schema of the database in a separate `.py` file inside. If we have schemas with redundant tables, it's possible to have an extra file called something like `base.py` which reflects the common tables of our schemas. Since tables are reflected as python classes, we can then inherit those base table classes in our schema specific classes. An example `base.py` file in our case:

{% highlight python %}
# base.py



{% endhighlight %}

[sqlalchemy]: https://www.sqlalchemy.org/
[orm]:   https://docs.sqlalchemy.org/en/14/orm/tutorial.html
