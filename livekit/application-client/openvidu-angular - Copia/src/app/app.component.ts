import { Component, HostListener, OnDestroy, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
    LocalVideoTrack,
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    Room,
    RoomEvent,
} from 'livekit-client';
import { lastValueFrom } from 'rxjs';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [ReactiveFormsModule, HttpClientModule,  CommonModule, FormsModule],
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnDestroy {
    roomForm = new FormGroup({
        roomName: new FormControl('Test Room', Validators.required),
        participantName: new FormControl('', Validators.required),
    });

    username: string = '';
    password: string = '';
    rol: string = '';
    adminKey: string = '';
    isMainCamera: boolean = false;
    newUser: boolean = false;

    room = signal<Room | undefined>(undefined);
    localTrack = signal<LocalVideoTrack | undefined>(undefined);
    remoteTracksMap = signal<Map<string, RemoteTrackPublication>>(new Map());

    constructor(private httpClient: HttpClient, private router: Router) {}

    toggleNewUser(event: Event): void {
        event.preventDefault();
        this.newUser = !this.newUser;
    }

    async login(): Promise<void> {
        if (!this.username || !this.password) {
            alert('Por favor, completa todos los campos para iniciar sesión.');
            return;
        }

        try {
            const response: any = await lastValueFrom(
                this.httpClient.post('http://localhost:3000/login', { username: this.username, password: this.password })
            );

            alert('Inicio de sesión exitoso');

            // Asignar el rol al usuario actual
            this.rol = response.rol;

            if (this.rol === 'administrador') {
                this.router.navigate(['/camera']); // Redirige a cámara
            } else if (this.rol === 'basico') {
                this.router.navigate(['/streaming']); // Redirige a streaming
            } else {
                alert('Rol no reconocido');
            }
        } catch (err) {
            console.error('Error al iniciar sesión:', err);
            alert('Usuario o contraseña incorrectos.');
        }
    }

    async register(): Promise<void> {
        if (!this.username || !this.password || !this.rol || !this.adminKey) {
            alert('Por favor, completa todos los campos para registrar un usuario.');
            return;
        }

        try {
            const response: any = await lastValueFrom(
                this.httpClient.post('http://localhost:3000/register', {
                    username: this.username,
                    password: this.password,
                    adminKey: this.adminKey,
                    rol: this.rol,
                })
            );

            alert('Usuario registrado exitosamente');
            this.newUser = false; // Regresar al modo de inicio de sesión
        } catch (err) {
            console.error('Error al registrar usuario:', err);
            alert('No se pudo registrar el usuario. Verifica la clave de administrador o los datos ingresados.');
        }
    }

    async joinRoom(): Promise<void> {
        const roomName = this.roomForm.value.roomName!;
        const participantName = this.username; // Usar el nombre de usuario como nombre del participante

        const room = new Room();
        this.room.set(room);

        room.on(
            RoomEvent.TrackSubscribed,
            (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
                this.remoteTracksMap.update((map) => {
                    map.set(publication.trackSid, publication);
                    return map;
                });
            }
        );

        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
            this.remoteTracksMap.update((map) => {
                map.delete(publication.trackSid);
                return map;
            });
        });

        try {
            const token = await this.getToken(roomName, participantName);
            await room.connect('ws://localhost:7880/', token);

            if (this.rol === 'administrador') {
                this.isMainCamera = true;
                await room.localParticipant.enableCameraAndMicrophone();
                this.localTrack.set(room.localParticipant.videoTrackPublications.values().next().value.videoTrack);
            } else {
                this.isMainCamera = false;
                // Usuarios básicos no transmiten, solo reciben el streaming
            }
        } catch (error: any) {
            console.log('Error al conectar con la sala:', error);
            await this.leaveRoom();
        }
    }

    async leaveRoom(): Promise<void> {
        await this.room()?.disconnect();
        this.room.set(undefined);
        this.localTrack.set(undefined);
        this.remoteTracksMap.set(new Map());
    }

    async getToken(roomName: string, participantName: string): Promise<string> {
        const response = await lastValueFrom(
            this.httpClient.post<{ token: string }>('http://localhost:3000/token', { roomName, participantName })
        );
        return response.token;
    }

    @HostListener('window:beforeunload')
    async ngOnDestroy(): Promise<void> {
        await this.leaveRoom();
    }
}
