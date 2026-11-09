"""Run with python3 tests/schema_test.py from the repository root."""
import sqlite3
from pathlib import Path

connection = sqlite3.connect(':memory:')
connection.execute('PRAGMA foreign_keys=ON')
connection.executescript(Path('schema.sql').read_text())
connection.execute("INSERT INTO users(id) VALUES ('u')")
connection.execute("INSERT INTO user_profiles(user_id,summary_text) VALUES ('u','相談：仕事。')")
invalid_statements = [
    "INSERT INTO users(id,plan_type) VALUES ('bad','admin')",
    "UPDATE users SET used_seconds_today=-1",
    "UPDATE user_profiles SET summary_text='" + 'あ' * 51 + "'",
    "INSERT INTO user_profiles(user_id) VALUES ('missing')",
    "INSERT INTO cocktails(id,name,phrase,description,image_url,is_active) VALUES ('x','x','x','x','/x',2)",
]
for statement in invalid_statements:
    try:
        connection.execute(statement)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError(statement)
connection.execute("DELETE FROM users WHERE id='u'")
assert connection.execute('SELECT count(*) FROM user_profiles').fetchone()[0] == 0
print('SQLite: initial schema, constraints and cascade passed')
