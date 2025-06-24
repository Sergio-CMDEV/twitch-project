from flask import Flask, render_template, jsonify
import pymysql

app = Flask(__name__)

# Configuración MySQL
db_config = {
    'host': 'localhost',
    'user': 'root',
    'password': 'TU_PASSWORD',
    'database': 'mykingdom'
}

# Ruta para renderizar main.html
@app.route('/')
def index():
    return render_template('main.html')

# Ruta API para obtener datos del usuario (simulado con id=1)
@app.route('/api/dashboard')
def dashboard_data():
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT reino, monedas FROM usuarios WHERE id = 1")  # Cambia 'usuarios' por tu tabla real
            result = cursor.fetchone()
            if result:
                reino, monedas = result
                return jsonify({'reino': reino, 'monedas': monedas})
            else:
                return jsonify({'error': 'Usuario no encontrado'}), 404
    finally:
        connection.close()

if __name__ == '__main__':
    app.run(debug=True)
