from app import app, db

with app.app_context():
    db.session.execute(
        db.text(
            "ALTER TABLE eopcrf1_approving_authority "
            "ADD COLUMN position VARCHAR(255) NOT NULL DEFAULT ''"
        )
    )
    db.session.commit()
    print("Column added.")