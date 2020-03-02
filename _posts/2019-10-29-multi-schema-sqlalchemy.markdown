---
layout: post
title:  "Multi-schema Postgres database handling through SQLAlchemy"
date:   2019-10-29 22:13:11 +0100
categories: Python
---
![]({{site.baseurl}}/assets/img/chongching_bridge.png){:class="img-centered":height="200px" width="800px"}
*Chongqing, China, 2013. &#9400; Arkadij Kummer*

[SQLAlchemy][sqlalchemy] is a great and mature database API for python. While reflecting a simple database through it's [ORM (object relational mapper)][orm] is quite straightforward, I found things to complicate a bit once I wanted to faithfully reflect a database with multiple schemas. Specifically, I had a Postgres database containing multiple schemas, which had in part tables with the same name. In the following I will go through the steps to

- represent a multischema Postgres db through use of the SQLAlchemy ORM,
- dynamically query tables with the same name in different schemas, and finally,
- implement the db migration tool alembic in a way that allows generating migrations on a per-schema basis.

For this, I will use a dummy example database containing two schemas (`Asia` and `Europe`).

#### Represent a multischema Postgres db through use of the SQLAlchemy ORM 

First, we need a place where we put all files dealing with reflecting our database. A common way is to have a `db` folder, and reflecting each schema of the database in a separate `.py` file inside. If we have schemas with redundant tables, it's possible to have an extra file called something like `base.py` which reflects the common tables of our schemas. Since tables are reflected as python classes, we can then inherit those base table classes in our schema specific table classes and customise them further. An example `base.py` file in our case, containing The common tables `Countries` and `Capitals`:

{% highlight python %}
# base.py

import sqlalchemy as sa
from sqlalchemy.ext.declarative import declarative_base

# We create a base class from which all our table classes will inherit
Base = declarative_base()

Class Countries(Base):
    # Since the tables defined here are only 'skeleton' tables used as
    # the base for our schema-specific tables, we set abstract to True.
    __abstract__ = True

    country_id = sa.Column(sa.Integer, primary_key=True)
    name = sa.Column(sa.String(100), nullable=False)
    population = sa.Column(sa.Integer)
    # Any foreign keys or relationships need to have the @declared_attr decorator in
    # an abstract class and be defined in the following way:
    @declared_attr
    def capital(cls):
        return sa.orm.relationship("Capitals", backref="capital", lazy="dynamic")
    

Class Capitals(Base):
    __abstract__ = True
    
    capital_id = sa.Column(sa.Integer, primary_key=True)
    name = sa.Column(sa.String(100), nullable=False)
    
    @declared_attr
    def country(cls):
        return sa.Column(sa.String, sa.ForeignKey("countries.name"), nullable=False)

{% endhighlight %}

We now have the 'skeleton' of our database, which SqlAlchemy will not actually try to link to our database,
since we used the `abstractbase` class in constructing it.
In the next step, we are going to create two more files,
in which we will reflect the two _actual_ schemas of our database, `asia.py` and `europe.py`:

{% highlight python %}
# asia.py

import sqlalchemy as sa
from sqlalchemy.ext.declarative import declarative_base

# We import the common tables from our abstract base class
from .base import Countries, Capitals
# We declare the schema-name as metadata in the declarative base
AsiaBase = declarative_base(metadata=MetaData(schema="asia"))

# Now we can add the tables from our base class, and modify them if needed
Class Countries(AsiaBase, Countries)
    # Since this is an actual table in our database, we set the tablename attribute
    __tablename__ = "countries"

    # Because this class inherits the Countries class from our base.py file, all columns
    # we specified there will be present in this table automatically
    # We can now add custom columns to the countries table of our asia schema:
    signature_dish = sa.Column(sa.String(100))


Class Capitals(AsiaBase, Capitals):
    __tablename__ = 'capitals'


# We can also add tables thaat are specific to the asia schema
Class Languages(AsiaBase):
    __tablename__ = 'languages'
    language_id = sa.Column(sa.Integer, primary_key=True)
    # Foreign keys and relationships can be declared normally here
    country = sa.Column(sa.String, sa.ForeignKey(countries.name))
{% endhighlight %}

{% highlight python %}
# europe.py

import sqlalchemy as sa
from sqlalchemy.ext.declarative import declarative_base

from .base import Countries, Capitals

EuropeBase = declarative_base(metadata=MetaData(schema="europe"))


Class Countries(EuropeBase, Countries)
    # Since this is an actual table in our database, we set the tablename attribute
    __tablename__ = "countries"

    eu_member = sa.Column(sa.Boolean)


Class Capitals(EuropeBase, Capitals):
    __tablename__ = 'capitals'

{% endhighlight %}

We are now ready to establish a connection to our database through the use of [Sessions][sessions].
I will not go into details about SqlAlchemy's connection API, as there are a lot of good resources out there about this.

I we want to simply interact with one of our schemas, e.g. the asia schema, it would look something like this:

{% highlight python %}

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.asia import Countries

engine = create_engine("postgres+psycopg2://admin:password@host:5432/worlddb)
Session = sessionmaker(bind=engine)
session = Session()

q = session.query(Asia.Countries).all()

new_country = Countries(name="Japan", population=126000000, signature_dish="Ramen")

session.add(new_country)
session.commit()
session.close()

{% endhighlight %}

#### Dynamically query tables with the same name in different schemas

Above, we interacted with `countries` table in our `asia` schema.
But what would we do, if we wanted to query and add things both to
the `countries` table of our `asia` _and_ the `countries` table of our `europe` schema,
depending on the context? Lets say, we want a function that can insert stuff into our tables,
and takes the schema whose tables it should target as an argument.
I have encountered this problem at work, and searching the web for quite some time didn't
result in any good answers. Finally, a collegue noted that dynamical imports are a thing in Python.
Entry `importlib`!
`importlib`'s `import_module` function lets us dynamically import packages, or in our case our database classes.
This way we can, at runtime, import the database class we need:


{% highlight python %}

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from importlib import import_module

engine = create_engine("postgres+psycopg2://admin:password@host:5432/worlddb)
Session = sessionmaker(bind=engine)
session = Session()

q = session.query(Asia.Countries).all()

def add_country(schema: str, **kwargs):
    # We dynamically import the schema module we need
    schema_module = import_module(f".db.{schema}", package="worlddb")
    
    new_country = schema_module.Countries(**kwargs)

    sess.add(new_country)
    sess.commit()
    sess.close()

{% endhighlight %}

We can now use our `add_country` function to add entries to the `countries` table in both schemas:

{% highlight python %}

add_country(schema="asia", name="Japan", population=126000000, signature_dish="Ramen")


add_country(schema="europe", name="Switzerland", population=7000000, eu_member=False)

{% endhighlight %}

#### Using alembic with our multi-schema database

The maker of `Sqlalchemy` has also made a very cool database migration tool called [alembic][almbc].
While it is trivial to set up for a single schema database, in the case of mutliple schemas
things get complicated (again). In the follwing I will go through how we would set up alembic
in a way such that we could perform migrations for the different schemas seperately.
Basically, we will set up a seperate `alembic` instance for each schema.
To set up a new alembic instance, we first go the terminal,
navigate to our project directory and initialize alembic:

{% highlight bash %}

$ cd projects/worlddb
$ alembic init asia_alembic # for the europe schema, we would put europe_alembic

{% endhighlight %}

This will generate an `alembic` folder, with an `alembic.ini` file
and an `asia_alembic` folder in it.
For all other inits for new schemas, new `alembic.ini` files will be put into the `alembic` folder,
so first, we need to rename `alembic.ini` to `asia_alembic.ini`.
In the `.ini` file, we modify the `script_location` and set our db url:

{% highlight python %}
# asia_alembic.ini

script_location = asia_alembic
sqlalchemy_url = postgres+psycopg2://admin:password@host:5432/worlddb

{% endhighlight %}

Next, we move into the `asia_alembic` folder. Therem we modify `env.py` as follows:

{% highlight python %}
# env.py

# Import the declarative base of the schema
from ngpep.db.asia import AsiaBase

# Modify target metadata
target_metadata = AsiaBase.metadata

{% endhighlight %}

We also need to add a function above the `run_migrations_online` function
which makes surethat only tables of the `asia` schema 
are considered in the autogeneration of migrations:

{% highlight python %}
# env.py

def include_object(object, name, type_, reflected, compare_to):
    if type_ == 'table' and object.schema != target_metadata.schema:
        return False
    return True

{% endhighlight %}

Finally, we modify the `run_migrations_online` function itself:

{% highlight python %}
# env.py

def run_migrations_online():
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )


    with connectable.connect() as connection:
        # Here we set our custom schema configuration
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table="asia_alembic_version", # Table in the db which will save the current alembic version of this schema
            version_table_schema=target_metadata.schema, # Alternative: "public", to put version tables in seperate schema
            include_schemas=True,
            include_object=include_object,
        )


        with context.begin_transaction():
            context.run_migrations()

{% endhighlight %}

That's it! We are now ready to generate our first revision for the `asia` schema.
Navigate to the `alembic` folder in the console, and start the revision:

{% highlight bash%}

$ cd projects/worlddb/alembic
$ alembic -c asia_alembic.ini revision --autogenerate -m 'my first revision'

{% endhighlight %}

Always check the autogenerated revision file in the
`versions` folder carefully, to see whether all
changes made in the ORM model were reflected faithfully.

If we now want to upgrade our db to the newest revision,
simply run an upgrade while specifying the revision file to use:

{% highlight bash%}

$ alembic ugrade 1975ea83b712_my_first_migration.py

{% endhighlight %}

Downgrades work analogous through the `downgrade` command.


We're done! We now have a way of dynamically querying our multi-schema database
using `sqlachemy`, and can even perform migrations on a per-schema basis!

If you have any suggestions of how to solve this in a different way or
more elegantly, please let me know in the comments!


[sqlalchemy]: https://www.sqlalchemy.org/
[orm]: https://docs.sqlalchemy.org/en/14/orm/tutorial.html
[sessions]: https://docs.sqlalchemy.org/en/14/orm/session_basics.html?highlight=sessions
[almbc]: https://alembic.sqlalchemy.org/en/latest/ 
