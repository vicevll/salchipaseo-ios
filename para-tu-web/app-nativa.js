/*
 * app-nativa.js — conecta tu web con las funciones nativas de la app iOS.
 *
 * Cópialo a tu web e inclúyelo ANTES de tu propio código:
 *   <script src="app-nativa.js"></script>
 *
 * Dentro de la app iOS usa GPS en segundo plano y notificaciones locales reales.
 * En un navegador normal usa las APIs web como respaldo (solo con la página abierta).
 *
 * Todo queda en window.AppNativa. Ver ejemplos en el README.
 */
(function () {
  "use strict";

  var cap = window.Capacitor;
  var esApp = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  var plugins = esApp ? cap.Plugins || {} : {};
  var BG = plugins.BackgroundGeolocation;
  var LN = plugins.LocalNotifications;
  var HTTP = plugins.CapacitorHttp;

  /* ------------------------------------------------------------------ */
  /* Ubicación (sigue funcionando con la pantalla bloqueada en la app)   */
  /* ------------------------------------------------------------------ */

  /**
   * Empieza a seguir la ubicación.
   * @param {(ubicacion) => void} alRecibir  recibe {latitude, longitude, accuracy, altitude, speed, bearing, time}
   * @param {(error) => void} [alFallar]
   * @param {{distanciaMinima?: number}} [opciones]  metros mínimos entre lecturas (por defecto 20)
   * @returns {Promise<() => Promise<void>>} función para detener el seguimiento
   */
  function seguirUbicacion(alRecibir, alFallar, opciones) {
    opciones = opciones || {};
    alFallar = alFallar || function (e) { console.error("[AppNativa] ubicación:", e); };
    var distancia = typeof opciones.distanciaMinima === "number" ? opciones.distanciaMinima : 20;

    if (BG) {
      var id = BG.addWatcher(
        {
          // Con backgroundMessage definido, iOS sigue entregando ubicaciones en segundo plano
          backgroundMessage: "Registrando tu ubicación",
          backgroundTitle: "Ubicación activa",
          requestPermissions: true,
          stale: false,
          distanceFilter: distancia
        },
        function (ubicacion, error) {
          if (error) {
            if (error.code === "NOT_AUTHORIZED") {
              error.mensaje = "Sin permiso de ubicación. Usa AppNativa.abrirAjustes() y permite la ubicación.";
            }
            return alFallar(error);
          }
          if (ubicacion) alRecibir(ubicacion);
        }
      );
      return Promise.resolve(id).then(function (watcherId) {
        return function detener() { return BG.removeWatcher({ id: watcherId }); };
      });
    }

    if (!("geolocation" in navigator)) {
      return Promise.reject(new Error("Geolocalización no disponible en este navegador"));
    }
    var watchId = navigator.geolocation.watchPosition(
      function (pos) {
        alRecibir({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          bearing: pos.coords.heading,
          time: pos.timestamp,
          simulated: false
        });
      },
      alFallar,
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    return Promise.resolve(function detener() {
      navigator.geolocation.clearWatch(watchId);
      return Promise.resolve();
    });
  }

  /** Abre los Ajustes del iPhone en la página de la app (para dar permiso "Siempre"). */
  function abrirAjustes() {
    return BG ? BG.openSettings() : Promise.resolve();
  }

  /* ------------------------------------------------------------------ */
  /* Avisos / alarmas (llegan aunque la app esté cerrada)                */
  /* ------------------------------------------------------------------ */

  var timersWeb = {};

  /** Pide permiso para mostrar notificaciones. Devuelve Promise<boolean>. */
  function pedirPermisoAvisos() {
    if (LN) {
      return LN.requestPermissions().then(function (r) { return r.display === "granted"; });
    }
    if ("Notification" in window) {
      return Notification.requestPermission().then(function (r) { return r === "granted"; });
    }
    return Promise.resolve(false);
  }

  /**
   * Programa un aviso.
   * @param {string} titulo
   * @param {string} texto
   * @param {Date|number} cuando  una fecha, o segundos desde ahora
   * @param {{id?: number, sonido?: string, datos?: object}} [opciones]
   *        sonido: archivo .wav/.caf (máx. 30 s) puesto en la carpeta www/ del proyecto de la app
   * @returns {Promise<number>} id del aviso (para cancelarlo)
   */
  function programarAviso(titulo, texto, cuando, opciones) {
    opciones = opciones || {};
    var fecha = typeof cuando === "number" ? new Date(Date.now() + cuando * 1000) : cuando;
    var id = typeof opciones.id === "number" ? opciones.id : Math.floor(Math.random() * 2000000000) + 1;

    if (LN) {
      return LN.schedule({
        notifications: [{
          id: id,
          title: titulo,
          body: texto,
          schedule: { at: fecha, allowWhileIdle: true },
          // En iOS, sin "sound" el aviso llega en silencio. Un nombre que no existe
          // hace que iOS use el sonido por defecto.
          sound: opciones.sonido || "sonido-por-defecto.wav",
          extra: opciones.datos || null
        }]
      }).then(function () { return id; });
    }

    // Navegador: solo funciona mientras la página siga abierta
    var ms = Math.max(0, fecha.getTime() - Date.now());
    timersWeb[id] = setTimeout(function () {
      delete timersWeb[id];
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(titulo, { body: texto });
      } else {
        console.log("[AppNativa] aviso:", titulo, texto);
      }
    }, ms);
    return Promise.resolve(id);
  }

  /** Cancela un aviso programado. */
  function cancelarAviso(id) {
    if (LN) return LN.cancel({ notifications: [{ id: id }] });
    clearTimeout(timersWeb[id]);
    delete timersWeb[id];
    return Promise.resolve();
  }

  /** Lista los avisos pendientes (solo en la app). */
  function avisosPendientes() {
    if (LN) return LN.getPending().then(function (r) { return r.notifications; });
    return Promise.resolve(Object.keys(timersWeb).map(function (id) { return { id: Number(id) }; }));
  }

  /** Ejecuta una función cuando el usuario toca un aviso. Recibe el aviso (con .extra). */
  function alTocarAviso(funcion) {
    if (LN) {
      LN.addListener("localNotificationActionPerformed", function (evento) {
        funcion(evento.notification);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Enviar datos a tu servidor (más confiable en segundo plano)         */
  /* ------------------------------------------------------------------ */

  /**
   * POST JSON a tu servidor. En la app usa la conexión nativa de iOS,
   * que no depende de que la vista web esté activa.
   * @returns {Promise<{status: number, data: any}>}
   */
  function enviar(url, datos, encabezados) {
    var headers = Object.assign({ "Content-Type": "application/json" }, encabezados || {});
    if (HTTP) {
      return HTTP.request({ url: url, method: "POST", headers: headers, data: datos })
        .then(function (r) { return { status: r.status, data: r.data }; });
    }
    return fetch(url, { method: "POST", headers: headers, body: JSON.stringify(datos), keepalive: true })
      .then(function (r) {
        return r.text().then(function (t) {
          var data = t;
          try { data = JSON.parse(t); } catch (e) { /* respuesta no JSON */ }
          return { status: r.status, data: data };
        });
      });
  }

  window.AppNativa = {
    esApp: esApp,
    seguirUbicacion: seguirUbicacion,
    abrirAjustes: abrirAjustes,
    pedirPermisoAvisos: pedirPermisoAvisos,
    programarAviso: programarAviso,
    cancelarAviso: cancelarAviso,
    avisosPendientes: avisosPendientes,
    alTocarAviso: alTocarAviso,
    enviar: enviar
  };
})();
